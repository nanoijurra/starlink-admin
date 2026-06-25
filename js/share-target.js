const SHARE_CACHE = 'starlink-share-target-v1';
const META_URL = new URL('./share-target-metadata.json', window.location.href).href;
const FILE_URL = new URL('./share-target-file', window.location.href).href;

const statusNode = document.getElementById('share-status');
const fileNode = document.getElementById('share-file');
const previewNode = document.getElementById('share-preview');
const backButton = document.getElementById('volver-app');
const discardButton = document.getElementById('descartar-comprobante');

backButton.addEventListener('click', () => {
  window.location.href = './index.html';
});

discardButton.addEventListener('click', async () => {
  if ('caches' in window) {
    await caches.delete(SHARE_CACHE);
  }
  fileNode.innerHTML = '';
  previewNode.innerHTML = '';
  statusNode.textContent = 'Comprobante descartado';
});

loadSharedFile().catch((error) => {
  console.warn('No se pudo leer el comprobante compartido.', error);
  statusNode.textContent = 'No hay comprobante recibido para mostrar.';
});

async function loadSharedFile() {
  if (!('caches' in window)) {
    statusNode.textContent = 'Cache API no disponible en este navegador.';
    return;
  }

  const cache = await caches.open(SHARE_CACHE);
  const metadataResponse = await cache.match(META_URL);
  if (!metadataResponse) {
    statusNode.textContent = 'No hay comprobante recibido para mostrar.';
    return;
  }

  const metadata = await metadataResponse.json();
  const fileResponse = await cache.match(FILE_URL);
  statusNode.textContent = 'Comprobante listo para revisar.';
  renderMetadata(metadata);

  if (!metadata.file || !fileResponse) {
    previewNode.innerHTML = '<p class="muted">No se recibio archivo adjunto.</p>';
    return;
  }

  if (metadata.file.type.startsWith('image/')) {
    const blob = await fileResponse.blob();
    const objectUrl = URL.createObjectURL(blob);
    previewNode.innerHTML = `<img src="${objectUrl}" alt="Vista previa del comprobante">`;
    return;
  }

  if (metadata.file.type === 'application/pdf') {
    previewNode.innerHTML = '<p class="muted">PDF recibido. La vista previa automatica se agregara en una etapa posterior.</p>';
    return;
  }

  previewNode.innerHTML = '<p class="muted">Archivo recibido sin vista previa disponible.</p>';
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
