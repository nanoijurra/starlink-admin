import { createSupabaseClient, ensureUserProfile, getSession } from './auth.js';

const SHARE_CACHE = 'starlink-share-target-v1';
const META_URL = new URL('./share-target-metadata.json', window.location.href).href;
const FILE_URL = new URL('./share-target-file', window.location.href).href;
const MES_PATTERN = /^\d{4}-\d{2}$/;

const statusNode = document.getElementById('share-status');
const fileNode = document.getElementById('share-file');
const previewNode = document.getElementById('share-preview');
const formNode = document.getElementById('share-form');
const mesInput = document.getElementById('share-mes');
const montoInput = document.getElementById('share-monto');
const observacionesInput = document.getElementById('share-observaciones');
const backButton = document.getElementById('volver-app');
const discardButton = document.getElementById('descartar-comprobante');

const state = {
  supabase: null,
  session: null,
  profile: null,
  metadata: null,
  file: null
};

backButton.addEventListener('click', () => {
  window.location.href = './index.html';
});

discardButton.addEventListener('click', async () => {
  await clearSharedCache();
  state.metadata = null;
  state.file = null;
  fileNode.innerHTML = '';
  previewNode.innerHTML = '';
  formNode.hidden = true;
  statusNode.textContent = 'Comprobante descartado.';
});

formNode.addEventListener('submit', submitSharedComprobante);

bootShareTarget().catch((error) => {
  console.warn('No se pudo preparar el comprobante compartido.', error);
  statusNode.textContent = error?.message || 'No hay comprobante recibido para mostrar.';
});

async function bootShareTarget() {
  mesInput.value = currentMonth();
  await loadSharedFile();
  await loadSession();
  updateFormAvailability();
}

async function loadSession() {
  state.supabase = await createSupabaseClient();
  state.session = await getSession(state.supabase);

  if (!state.session) {
    statusNode.innerHTML = `
      <p class="notice" data-type="info">Para enviar el comprobante tenes que iniciar sesion en la app.</p>
      <a class="small-link" href="./index.html">Ir a iniciar sesion</a>
    `;
    return;
  }

  state.profile = await ensureUserProfile(state.supabase, state.session.user);
  if (!state.profile?.persona_id) {
    statusNode.innerHTML = '<p class="notice" data-type="info">Tu cuenta esta pendiente de vinculacion con una persona. Avisa al administrador.</p>';
    return;
  }

  statusNode.textContent = 'Comprobante listo para enviar como pendiente.';
}

function updateFormAvailability() {
  formNode.hidden = !(state.file && state.session && state.profile?.persona_id);
}

async function loadSharedFile() {
  if (!('caches' in window)) {
    throw new Error('Cache API no disponible en este navegador.');
  }

  const cache = await caches.open(SHARE_CACHE);
  const metadataResponse = await cache.match(META_URL);
  if (!metadataResponse) {
    throw new Error('No hay comprobante recibido para mostrar.');
  }

  const metadata = await metadataResponse.json();
  const fileResponse = await cache.match(FILE_URL);
  state.metadata = metadata;
  renderMetadata(metadata);

  if (!metadata.file || !fileResponse) {
    previewNode.innerHTML = '<p class="muted">No se recibio archivo adjunto.</p>';
    return;
  }

  const blob = await fileResponse.blob();
  state.file = new File([blob], metadata.file.name || 'comprobante', {
    type: metadata.file.type || blob.type || 'application/octet-stream'
  });

  if (state.file.type.startsWith('image/')) {
    const objectUrl = URL.createObjectURL(state.file);
    previewNode.innerHTML = `<img src="${objectUrl}" alt="Vista previa del comprobante">`;
    return;
  }

  if (state.file.type === 'application/pdf') {
    previewNode.innerHTML = '<p class="muted">PDF recibido. Se guardara como archivo adjunto pendiente.</p>';
    return;
  }

  previewNode.innerHTML = '<p class="muted">Archivo recibido sin vista previa disponible.</p>';
}

async function submitSharedComprobante(event) {
  event.preventDefault();

  if (!state.session || !state.profile?.persona_id) {
    statusNode.textContent = 'Para enviar el comprobante tenes que iniciar sesion y estar vinculado a una persona.';
    return;
  }
  if (!state.file) {
    statusNode.textContent = 'No hay archivo recibido para enviar.';
    return;
  }

  const mes = mesInput.value;
  if (!MES_PATTERN.test(mes)) {
    statusNode.textContent = 'Selecciona un mes valido.';
    return;
  }

  try {
    formNode.querySelector('button[type="submit"]').disabled = true;
    statusNode.textContent = 'Subiendo comprobante...';
    const archivoPath = comprobanteStoragePath(state.profile.persona_id, mes, state.file);
    const { error: uploadError } = await state.supabase
      .storage
      .from('comprobantes-pago')
      .upload(archivoPath, state.file, {
        contentType: state.file.type || 'application/octet-stream',
        upsert: false
      });
    if (uploadError) throw uploadError;

    const monto = montoInput.value === ''
      ? null
      : Number(String(montoInput.value).replace(',', '.'));
    if (monto !== null && (!Number.isFinite(monto) || monto < 0)) {
      throw new Error('El monto informado no puede ser negativo.');
    }
    const { error: insertError } = await state.supabase
      .from('comprobantes_pago')
      .insert({
        persona_id: state.profile.persona_id,
        mes_aplicado: mes,
        monto_informado: monto,
        archivo_bucket: 'comprobantes-pago',
        archivo_path: archivoPath,
        archivo_nombre: state.file.name || 'comprobante',
        archivo_tipo: state.file.type || 'application/octet-stream',
        archivo_tamano: state.file.size || 0,
        estado: 'PENDIENTE',
        observaciones: observacionesInput.value.trim() || null,
        created_by: state.session.user.id
      });
    if (insertError) throw insertError;

    await clearSharedCache();
    formNode.hidden = true;
    statusNode.textContent = 'Comprobante enviado. Queda pendiente de revision por el administrador.';
  } catch (error) {
    statusNode.textContent = error?.message || 'No se pudo enviar el comprobante.';
  } finally {
    formNode.querySelector('button[type="submit"]').disabled = false;
  }
}

async function clearSharedCache() {
  if ('caches' in window) {
    await caches.delete(SHARE_CACHE);
  }
}

function comprobanteStoragePath(personaId, mes, file) {
  const id = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${personaId}/${mes}/${Date.now()}-${id}-${safeStorageFileName(file.name)}`;
}

function safeStorageFileName(name) {
  return String(name || 'comprobante')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'comprobante';
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function renderMetadata(metadata) {
  const file = metadata.file || {};
  fileNode.innerHTML = `
    <dl class="share-metadata">
      <div><dt>Nombre</dt><dd>${escapeHtml(file.name || 'Sin archivo')}</dd></div>
      <div><dt>Tipo</dt><dd>${escapeHtml(file.type || 'No informado')}</dd></div>
      <div><dt>Tamano</dt><dd>${escapeHtml(formatSize(file.size || 0))}</dd></div>
      <div><dt>Recibido</dt><dd>${escapeHtml(formatDate(metadata.receivedAt))}</dd></div>
    </dl>
  `;
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} bytes`;
}

function formatDate(value) {
  if (!value) return 'No informado';
  return new Date(value).toLocaleString('es-AR');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
