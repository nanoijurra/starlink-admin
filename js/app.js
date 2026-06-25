import { createSupabaseClient, ensureUserProfile, getSession, signIn, signOut, signUp } from './auth.js';
import {
  calcularCargosMensuales,
  calcularMoras,
  resumenDashboard,
  totalAbonoActualizado,
  totalEquipoActualizado
} from './calculos.js';
import { mensajePorCargo } from './mensajes.js';
import { conceptoOptions, descomponerPagoSegunCargo, renderPagosTable } from './pagos.js';
import { estadoOptions, personaOptions, renderPersonasTable } from './personas.js';
import {
  byId,
  currentMonth,
  downloadCsv,
  escapeHtml,
  formToObject,
  formatARS,
  normalizeNumber,
  round2,
  showNotice
} from './utils.js';

const CIERRE_MENSUAL_TOLERANCIA = 0.01;
const MES_CIERRE_PATTERN = /^\d{4}-\d{2}$/;

const state = {
  supabase: null,
  session: null,
  profile: null,
  config: null,
  personas: [],
  pagos: [],
  cierres: [],
  cargos: [],
  profiles: [],
  comprobantes: [],
  comprobantesFiltro: 'PENDIENTE',
  comprobanteProcesandoId: null,
  calculo: null
};

function isAdmin() {
  return state.profile?.rol === 'ADMIN';
}

function isUsuario() {
  return state.profile?.rol === 'USUARIO';
}

function setLoading(message) {
  showNotice(message, 'info');
}

function setOk(message) {
  showNotice(message, 'ok');
}

function setError(error) {
  showNotice(error?.message || String(error), 'error');
}

function validarMesCierre(mes) {
  return MES_CIERRE_PATTERN.test(String(mes || ''));
}

function cierrePorMes(mes, estado = null) {
  return state.cierres.find((cierre) => cierre.mes === mes && (!estado || cierre.estado === estado)) || null;
}

function diferenciaTotalMensual(calculo) {
  if (calculo?.diferencia_redondeo !== undefined) {
    return round2(calculo.diferencia_redondeo);
  }
  const totalEsperado = Number(calculo?.total_modelo ?? calculo?.total_abono_actualizado ?? 0);
  const totalCargos = (calculo?.cargos || []).reduce((total, cargo) => total + Number(cargo.monto_a_pagar || 0), 0);
  return round2(totalEsperado - totalCargos);
}

function cargoPayload(cierreId, cargo) {
  return {
    cierre_mensual_id: cierreId,
    persona_id: cargo.persona_id,
    mes: cargo.mes,
    abono_base: cargo.abono_base || 0,
    cargo_equipo: cargo.cargo_equipo || 0,
    concepto_equipo: cargo.concepto_equipo || null,
    compensacion_aplicada: cargo.compensacion_aplicada || 0,
    monto_a_pagar: cargo.monto_a_pagar,
    concepto: cargo.concepto,
    saldo_equipo_antes: cargo.saldo_equipo_antes,
    saldo_equipo_despues: cargo.saldo_equipo_despues,
    pagado: false
  };
}

function setSection(sectionId) {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === sectionId);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === sectionId);
  });
}

function applyAccess() {
  const readonly = !isAdmin();
  const role = state.profile?.rol;
  const allowedSections = role === 'USUARIO'
    ? ['mi-cuenta']
    : role === 'ADMIN'
      ? ['dashboard', 'config', 'usuarios', 'personas', 'pagos', 'comprobantes', 'calculo', 'mensajes', 'router', 'moras', 'exportacion']
      : ['dashboard', 'config', 'personas', 'pagos', 'comprobantes', 'calculo', 'mensajes', 'router', 'moras', 'exportacion'];

  document.querySelectorAll('.tabs button').forEach((button) => {
    const allowed = allowedSections.includes(button.dataset.section);
    button.hidden = !allowed;
    button.disabled = !allowed;
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.hidden = !allowedSections.includes(view.id);
  });

  document.querySelectorAll('.admin-only').forEach((node) => {
    node.hidden = readonly;
    node.querySelectorAll?.('input, select, textarea, button').forEach((field) => {
      field.disabled = readonly;
    });
  });
  byId('config-form').querySelectorAll('input').forEach((field) => {
    field.disabled = readonly || field.name === 'metodo_equilibrio';
  });

  byId('session-label').textContent = `${state.profile.email} - ${state.profile.rol}`;
  byId('session-box').hidden = false;

  const activeSection = document.querySelector('.view.active')?.id;
  if (!allowedSections.includes(activeSection)) {
    setSection(allowedSections[0]);
  }
}

async function loadTable(name, query = '*') {
  const { data, error } = await state.supabase.from(name).select(query);
  if (error) throw error;
  return data || [];
}

async function loadData() {
  setLoading('Cargando datos...');
  const [configs, personas, pagos, cierres, cargos, profiles, comprobantes] = await Promise.all([
    state.supabase.from('app_config').select('*').order('updated_at', { ascending: false }).limit(1),
    state.supabase.from('personas').select('*').order('nombre'),
    state.supabase.from('pagos').select('*').order('fecha_pago', { ascending: false }),
    state.supabase.from('cierres_mensuales').select('*').order('mes', { ascending: false }),
    state.supabase.from('cargos_mensuales').select('*').order('mes', { ascending: false }),
    state.supabase.from('profiles').select('*').order('email'),
    state.supabase.from('comprobantes_pago').select('*').order('created_at', { ascending: false })
  ]);

  for (const result of [configs, personas, pagos, cierres, cargos, profiles, comprobantes]) {
    if (result.error) throw result.error;
  }

  state.config = configs.data?.[0] || null;
  state.personas = personas.data || [];
  state.pagos = pagos.data || [];
  state.cierres = cierres.data || [];
  state.cargos = cargos.data || [];
  state.profiles = profiles.data || [];
  state.comprobantes = comprobantes.data || [];

  renderAll();
  showNotice('', 'info');
}

function renderAll() {
  applyAccess();
  renderConfig();
  renderUsuarios();
  renderMiCuenta();
  renderDashboard();
  renderPersonas();
  renderPagos();
  renderComprobantes();
  renderCalculo();
  renderMensajes();
  renderRouter();
  renderMoras();
}

function renderDashboard() {
  const mes = byId('dashboard-mes').value || currentMonth();
  const resumen = resumenDashboard(state.config, state.personas, state.pagos, state.cargos, mes);
  const metrics = [
    ['Usuarios activos', resumen.activos],
    ['Fundadores activos', resumen.fundadoresActivos],
    ['Ingresantes posteriores activos', resumen.ingresantesActivos],
    ['Pendientes', resumen.pendientes],
    ['Suspendidos por mora', resumen.suspendidos],
    ['Bajas definitivas', resumen.bajas],
    ['Total a recaudar del mes', formatARS(resumen.totalARecaudar)],
    ['Total pagado', formatARS(resumen.totalPagado)],
    ['Total pendiente', formatARS(resumen.totalPendiente)],
    ['Equipo actualizado', formatARS(totalEquipoActualizado(state.config))],
    ['Abono actualizado', formatARS(totalAbonoActualizado(state.config))]
  ];

  byId('dashboard-cards').innerHTML = metrics
    .map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`)
    .join('');
}

function renderConfig() {
  const form = byId('config-form');
  if (!state.config) {
    form.reset();
    return;
  }

  for (const field of [
    'compra_equipo',
    'recargo_compra_pct',
    'abono_mensual',
    'recargo_abono_pct',
    'fundadores_iniciales',
    'meses_mora_suspension',
    'alias_bancario',
    'metodo_equilibrio'
  ]) {
    form.elements[field].value = state.config[field] ?? '';
  }
}

function profilePersona(profile) {
  return state.personas.find((persona) => mismaPersona(persona.id, profile.persona_id)) || null;
}

function roleOptions(selected) {
  return ['ADMIN', 'LECTURA', 'USUARIO']
    .map((rol) => `<option value="${rol}" ${rol === selected ? 'selected' : ''}>${rol}</option>`)
    .join('');
}

function personaLinkOptions(selected = '') {
  const options = state.personas
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((persona) => `<option value="${escapeHtml(persona.id)}" ${mismaPersona(persona.id, selected) ? 'selected' : ''}>${escapeHtml(persona.nombre)}</option>`);
  return `<option value="">Sin vincular</option>${options.join('')}`;
}

function renderUsuarios() {
  const container = byId('usuarios-table');
  if (!container) return;
  if (!isAdmin()) {
    container.innerHTML = '';
    return;
  }

  const rows = state.profiles.map((profile) => {
    const persona = profilePersona(profile);
    return `
      <tr>
        <td>${escapeHtml(profile.email || '')}</td>
        <td>
          <select data-user-role="${escapeHtml(profile.id)}">
            ${roleOptions(profile.rol)}
          </select>
        </td>
        <td>
          <label class="check compact-check">
            <input type="checkbox" data-user-active="${escapeHtml(profile.id)}" ${profile.activo ? 'checked' : ''}>
            Activo
          </label>
        </td>
        <td>
          <select data-user-persona="${escapeHtml(profile.id)}">
            ${personaLinkOptions(profile.persona_id || '')}
          </select>
          <div class="muted">${escapeHtml(persona?.dependencia || '')}</div>
        </td>
        <td class="actions">
          <button type="button" data-user-unlink="${escapeHtml(profile.id)}">Desvincular</button>
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Rol</th>
          <th>Activo</th>
          <th>Persona vinculada</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || '<tr><td colspan="5">Sin usuarios cargados.</td></tr>'}</tbody>
    </table>
  `;
}

function comprobantesPersona(personaId) {
  return state.comprobantes
    .filter((comprobante) => mismaPersona(comprobante.persona_id, personaId))
    .sort((a, b) => `${b.created_at || ''}`.localeCompare(`${a.created_at || ''}`));
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} bytes`;
}

function comprobanteEstadoClass(estado) {
  if (estado === 'PROCESADO') return 'comprobante-procesado';
  if (estado === 'DESCARTADO') return 'comprobante-descartado';
  return 'comprobante-pendiente';
}

function comprobantePagoIds(comprobante) {
  const raw = comprobante?.pago_ids;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function renderComprobantesPersona(personaId) {
  const rows = comprobantesPersona(personaId).map((comprobante) => `
    <tr>
      <td>${escapeHtml(new Date(comprobante.created_at).toLocaleString('es-AR'))}</td>
      <td>${escapeHtml(comprobante.mes_aplicado || '')}</td>
      <td class="number">${comprobante.monto_informado == null ? '-' : formatARS(comprobante.monto_informado)}</td>
      <td>${escapeHtml(comprobante.archivo_nombre || '-')}</td>
      <td><span class="comprobante-status ${comprobanteEstadoClass(comprobante.estado)}">${escapeHtml(comprobante.estado || 'PENDIENTE')}</span></td>
      <td>${escapeHtml(comprobante.observaciones || '')}</td>
    </tr>
  `);

  return `
    <h3>Mis comprobantes</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Mes</th>
            <th>Monto informado</th>
            <th>Archivo</th>
            <th>Estado</th>
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>${rows.join('') || '<tr><td colspan="6">Sin comprobantes enviados.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function pagosExistentesPersonaMes(personaId, mes) {
  return state.pagos.filter((pago) => (
    mismaPersona(pago.persona_id, personaId) &&
    pago.mes_aplicado === mes
  ));
}

function renderComprobantePagoPanel() {
  const comprobante = state.comprobantes.find((item) => item.id === state.comprobanteProcesandoId);
  if (!isAdmin() || !comprobante || (comprobante.estado || 'PENDIENTE') !== 'PENDIENTE') return '';

  const persona = state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id));
  const pagosExistentes = pagosExistentesPersonaMes(comprobante.persona_id, comprobante.mes_aplicado);
  const pagosRows = pagosExistentes.map((pago) => `
    <tr>
      <td>${escapeHtml(pago.fecha_pago || '')}</td>
      <td><span class="badge">${escapeHtml(pago.concepto || '')}</span></td>
      <td class="number">${formatARS(pago.monto || 0)}</td>
      <td>${escapeHtml(pago.medio || '')}</td>
      <td>${escapeHtml(pago.observaciones || '')}</td>
    </tr>
  `);

  return `
    <article class="comprobante-process-panel">
      <div class="section-title">
        <div>
          <h3>Registrar pago desde comprobante</h3>
          <p class="muted">Revision manual de ADMIN antes de crear pagos reales.</p>
        </div>
        <button type="button" data-comprobante-process-cancel>Cancelar</button>
      </div>
      <div class="account-grid">
        <article class="metric"><span>Persona</span><strong>${escapeHtml(persona?.nombre || 'Sin persona')}</strong></article>
        <article class="metric"><span>Mes aplicado</span><strong>${escapeHtml(comprobante.mes_aplicado || '-')}</strong></article>
        <article class="metric"><span>Monto informado</span><strong>${comprobante.monto_informado == null ? '-' : formatARS(comprobante.monto_informado)}</strong></article>
        <article class="metric"><span>Archivo</span><strong>${escapeHtml(comprobante.archivo_nombre || '-')}</strong></article>
        <article class="metric wide"><span>Observaciones</span><strong>${escapeHtml(comprobante.observaciones || '-')}</strong></article>
      </div>
      ${pagosExistentes.length ? '<p class="notice" data-type="error">Esta persona ya tiene pagos registrados para este mes. Revisa antes de confirmar para evitar duplicados.</p>' : ''}
      <h4>Pagos existentes del mes</h4>
      <div class="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Monto</th>
              <th>Medio</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>${pagosRows.join('') || '<tr><td colspan="5">No hay pagos registrados para esta persona y mes.</td></tr>'}</tbody>
        </table>
      </div>
      <form id="comprobante-pago-form" class="grid-form upload-form">
        <input type="hidden" name="comprobante_id" value="${escapeHtml(comprobante.id)}">
        <label>Monto a registrar
          <input type="number" name="monto" min="0" step="0.01" value="${escapeHtml(comprobante.monto_informado ?? '')}" required>
        </label>
        <label>Medio
          <input type="text" name="medio" value="TRANSFERENCIA" required>
        </label>
        <label>Fecha de pago
          <input type="date" name="fecha_pago" value="${escapeHtml(new Date().toISOString().slice(0, 10))}" required>
        </label>
        <label class="wide">Observacion del pago
          <textarea name="observaciones" rows="2" placeholder="Confirmado desde comprobante ${escapeHtml(comprobante.archivo_nombre || '')}"></textarea>
        </label>
        <div class="form-actions">
          <button type="submit" class="primary">Confirmar y registrar pago</button>
          <button type="button" data-comprobante-process-cancel>Cancelar</button>
        </div>
      </form>
    </article>
  `;
}

function renderMiCuenta() {
  const container = byId('mi-cuenta-content');
  if (!container) return;

  if (!isUsuario()) {
    container.innerHTML = '<p class="muted">Vista disponible para usuarios vinculados a una persona.</p>';
    return;
  }

  if (!state.profile?.persona_id) {
    container.innerHTML = '<p class="notice" data-type="info">Tu cuenta esta pendiente de vinculacion con una persona. Avisa al administrador.</p>';
    return;
  }

  const persona = state.personas.find((item) => mismaPersona(item.id, state.profile.persona_id));
  if (!persona) {
    container.innerHTML = '<p class="notice" data-type="info">Tu cuenta esta pendiente de vinculacion con una persona. Avisa al administrador.</p>';
    return;
  }

  const mes = byId('mi-cuenta-mes').value || currentMonth();
  const cargo = state.cargos
    .filter((item) => item.mes === mes && mismaPersona(item.persona_id, persona.id) && cargoEsVigente(item))
    .map(cargoConPersona)[0] || null;
  const pagos = state.pagos
    .filter((pago) => mismaPersona(pago.persona_id, persona.id))
    .sort((a, b) => `${b.fecha_pago}${b.created_at || ''}`.localeCompare(`${a.fecha_pago}${a.created_at || ''}`));
  const cuenta = cargo ? estadoCuentaCargo(cargo) : estadoCuentaDesdePagos(persona.id, mes);
  const cuentaResumen = cuenta;
  const observacionCuenta = cargo ? observacionEstadoCuenta(cargo, cuenta) : cuenta.observacion;
  const estadoResumen = cuentaResumen.estado.toUpperCase();
  const mesCuenta = formatMesCuenta(mes);
  const statusClass = cuentaStatusClass(cuentaResumen.estado);

  const pagosRows = pagos.map((pago) => `
    <tr>
      <td>${escapeHtml(pago.fecha_pago || '')}</td>
      <td>${escapeHtml(pago.mes_aplicado || '')}</td>
      <td><span class="badge">${escapeHtml(pago.concepto || '')}</span></td>
      <td class="number">${formatARS(pago.monto || 0)}</td>
      <td>${escapeHtml(pago.observaciones || '')}</td>
    </tr>
  `);

  container.innerHTML = `
    <article class="account-status-card ${statusClass}">
      <span>Estado de cuenta al ${escapeHtml(mesCuenta)}</span>
      <strong>${escapeHtml(estadoResumen)}</strong>
      <div class="account-status-values">
        <span>Total del mes: <b>${formatARS(cuentaResumen.totalDelMes)}</b></span>
        <span>Pagado: <b>${formatARS(cuentaResumen.pagado)}</b></span>
        ${cuentaResumen.saldoAFavor > 0.01 ? `<span>Saldo a favor: <b>${formatARSNegativoVisual(cuentaResumen.saldoAFavor)}</b></span>` : ''}
        <span>Pendiente hoy: <b>${formatARS(cuentaResumen.pendiente)}</b></span>
      </div>
    </article>

    <div class="account-grid">
      <article class="metric"><span>Nombre</span><strong>${escapeHtml(persona.nombre || '')}</strong></article>
      <article class="metric"><span>Dependencia</span><strong>${escapeHtml(persona.dependencia || '-')}</strong></article>
      <article class="metric"><span>Estado</span><strong>${escapeHtml(persona.estado || '-')}</strong></article>
      <article class="metric"><span>Router</span><strong>${escapeHtml(persona.router_estado || '-')}</strong></article>
      <article class="metric"><span>Telefono WhatsApp</span><strong>${escapeHtml(persona.telefono_whatsapp || '-')}</strong></article>
      <article class="metric"><span>MAC 1 / MAC 2</span><strong>${escapeHtml([persona.mac_1 || persona.mac, persona.mac_2].filter(Boolean).join(' / ') || '-')}</strong></article>
    </div>

    <h3>Detalle del mes ${escapeHtml(mesCuenta)}</h3>
    <div class="account-grid">
      <article class="metric"><span>Equipo del mes</span><strong>${formatARS(cuenta.equipoDelMes)}</strong></article>
      <article class="metric"><span>Abono del mes</span><strong>${formatARS(cuenta.abonoDelMes)}</strong></article>
      <article class="metric"><span>Total del mes</span><strong>${formatARS(cuenta.totalDelMes)}</strong></article>
      <article class="metric"><span>Pagado</span><strong>${formatARS(cuenta.pagado)}</strong></article>
      <article class="metric"><span>Ajuste / saldo a favor</span><strong class="${cuenta.saldoAFavor > 0.01 ? 'saldo-favor' : 'valor-cero'}">${formatARSNegativoVisual(cuenta.saldoAFavor)}</strong></article>
      <article class="metric"><span>Pendiente hoy</span><strong class="${cuenta.pendiente <= 0.01 ? 'pending-ok' : 'pending-due'}">${formatARS(cuenta.pendiente)}</strong></article>
      <article class="metric"><span>Estado</span><strong>${escapeHtml(cuenta.estado)}</strong></article>
    </div>
    <p class="muted">${escapeHtml(observacionCuenta)}</p>

    <article class="upload-card">
      <h3>Subir comprobante</h3>
      <p class="muted">El comprobante queda pendiente de revision. No registra pagos automaticamente.</p>
      <form id="mi-cuenta-comprobante-form" class="grid-form upload-form">
        <label>Archivo
          <input type="file" name="archivo" accept="image/jpeg,image/png,image/webp,application/pdf" required>
        </label>
        <label>Mes aplicado
          <input type="month" name="mes_aplicado" value="${escapeHtml(mes)}" required>
        </label>
        <label>Monto informado
          <input type="number" name="monto_informado" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="wide">Observaciones
          <textarea name="observaciones" rows="2" placeholder="Datos opcionales para administracion"></textarea>
        </label>
        <button type="submit" class="primary">Enviar comprobante</button>
      </form>
    </article>

    <h3>Mis pagos</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Mes</th>
            <th>Concepto</th>
            <th>Monto</th>
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>${pagosRows.join('') || '<tr><td colspan="5">Sin pagos registrados.</td></tr>'}</tbody>
      </table>
    </div>

    ${renderComprobantesPersona(persona.id)}
  `;
}

function renderComprobantes() {
  const container = byId('comprobantes-table');
  if (!container) return;

  if (isUsuario()) {
    container.innerHTML = '<p class="muted">Vista disponible para administracion y lectura.</p>';
    return;
  }

  const counts = state.comprobantes.reduce((acc, comprobante) => {
    const estado = comprobante.estado || 'PENDIENTE';
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, { PENDIENTE: 0, PROCESADO: 0, DESCARTADO: 0 });
  const filtro = state.comprobantesFiltro || 'PENDIENTE';
  const comprobantesFiltrados = filtro === 'TODOS'
    ? state.comprobantes
    : state.comprobantes.filter((comprobante) => (comprobante.estado || 'PENDIENTE') === filtro);

  const rows = comprobantesFiltrados.map((comprobante) => {
    const persona = state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id));
    const estado = comprobante.estado || 'PENDIENTE';
    const pagoIds = comprobantePagoIds(comprobante);
    const discardButton = isAdmin() && (comprobante.estado || 'PENDIENTE') === 'PENDIENTE'
      ? `<button type="button" class="danger" data-comprobante-discard="${escapeHtml(comprobante.id)}">Descartar</button>`
      : '';
    const registerButton = isAdmin() && estado === 'PENDIENTE'
      ? `<button type="button" class="primary" data-comprobante-register="${escapeHtml(comprobante.id)}">Registrar pago</button>`
      : '';

    return `
      <tr>
        <td>${escapeHtml(new Date(comprobante.created_at).toLocaleString('es-AR'))}</td>
        <td>${escapeHtml(persona?.nombre || 'Sin persona')}</td>
        <td>${escapeHtml(comprobante.mes_aplicado || '')}</td>
        <td class="number">${comprobante.monto_informado == null ? '-' : formatARS(comprobante.monto_informado)}</td>
        <td>${escapeHtml(comprobante.archivo_nombre || '-')}</td>
        <td>${escapeHtml(comprobante.archivo_tipo || '-')}<br><span class="muted">${escapeHtml(formatFileSize(comprobante.archivo_tamano || 0))}</span></td>
        <td><span class="comprobante-status ${comprobanteEstadoClass(comprobante.estado)}">${escapeHtml(comprobante.estado || 'PENDIENTE')}</span></td>
        <td>${pagoIds.length ? `${pagoIds.length} pago(s)<br><span class="muted">${escapeHtml(pagoIds.join(', '))}</span>` : '-'}</td>
        <td>${escapeHtml(comprobante.observaciones || '')}</td>
        <td>
          <div class="table-actions">
            <button type="button" data-comprobante-view="${escapeHtml(comprobante.id)}">Ver comprobante</button>
            ${discardButton}
            ${registerButton}
          </div>
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="comprobantes-summary">
      <article><span>Pendientes</span><strong>${counts.PENDIENTE || 0}</strong></article>
      <article><span>Procesados</span><strong>${counts.PROCESADO || 0}</strong></article>
      <article><span>Descartados</span><strong>${counts.DESCARTADO || 0}</strong></article>
    </div>
    <div class="comprobantes-filters" aria-label="Filtro de comprobantes por estado">
      <button type="button" data-comprobante-filter="PENDIENTE" class="${filtro === 'PENDIENTE' ? 'active' : ''}">Pendientes</button>
      <button type="button" data-comprobante-filter="PROCESADO" class="${filtro === 'PROCESADO' ? 'active' : ''}">Procesados</button>
      <button type="button" data-comprobante-filter="DESCARTADO" class="${filtro === 'DESCARTADO' ? 'active' : ''}">Descartados</button>
      <button type="button" data-comprobante-filter="TODOS" class="${filtro === 'TODOS' ? 'active' : ''}">Todos</button>
    </div>
    ${renderComprobantePagoPanel()}
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Persona</th>
          <th>Mes</th>
          <th>Monto</th>
          <th>Archivo</th>
          <th>Tipo</th>
          <th>Estado</th>
          <th>Pagos asociados</th>
          <th>Observaciones</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || `<tr><td colspan="10">Sin comprobantes para el filtro ${escapeHtml(filtro.toLowerCase())}.</td></tr>`}</tbody>
    </table>
  `;
}

function renderPersonas() {
  byId('persona-estado').innerHTML = estadoOptions('ACTIVO');
  byId('personas-table').innerHTML = renderPersonasTable(state.personas, !isAdmin());
  byId('pago-persona').innerHTML = personaOptions(state.personas);
  byId('filtro-pago-persona').innerHTML = `<option value="">Todas</option>${personaOptions(state.personas).replace('<option value="">Seleccionar persona</option>', '')}`;
}

function pagosFiltrados() {
  const personaId = byId('filtro-pago-persona').value;
  const mes = byId('filtro-pago-mes').value;
  const concepto = byId('filtro-pago-concepto').value;

  return state.pagos.filter((pago) => {
    if (personaId && pago.persona_id !== personaId) return false;
    if (mes && pago.mes_aplicado !== mes) return false;
    if (concepto && pago.concepto !== concepto) return false;
    return true;
  });
}

function mismaPersona(left, right) {
  return String(left) === String(right);
}

function cargoConPersona(cargo) {
  if (!cargo) return null;
  return {
    ...cargo,
    persona: cargo.persona || state.personas.find((persona) => mismaPersona(persona.id, cargo.persona_id)) || null
  };
}

function cargoEsVigente(cargo) {
  const cierre = state.cierres.find((item) => item.id === cargo.cierre_mensual_id);
  return !cierre || cierre.estado !== 'ANULADO';
}

function calculoGuardadoPorMes(cierre) {
  const cargos = state.cargos
    .filter((cargo) => cargo.cierre_mensual_id === cierre.id && cargoEsVigente(cargo))
    .map(cargoConPersona)
    .filter((cargo) => cargo.persona);
  const totalAbonoBase = round2(cargos.reduce((total, cargo) => total + Number(cargo.abono_base || 0), 0));
  const totalCargoEquipo = round2(cargos.reduce((total, cargo) => total + Number(cargo.cargo_equipo || 0), 0));
  const totalCompensacionAplicada = round2(cargos.reduce((total, cargo) => total + Number(cargo.compensacion_aplicada || 0), 0));
  const sumaCargos = round2(cargos.reduce((total, cargo) => total + Number(cargo.monto_a_pagar || 0), 0));
  const totalModelo = round2(totalAbonoBase + totalCargoEquipo - totalCompensacionAplicada);

  return {
    mes: cierre.mes,
    cerrado: cierre.estado === 'CERRADO',
    total_equipo_actualizado: cierre.total_equipo_actualizado,
    total_abono_actualizado: cierre.total_abono_actualizado,
    usuarios_activos: cierre.usuarios_activos,
    total_abono_base: totalAbonoBase,
    total_cargo_equipo: totalCargoEquipo,
    total_compensacion_aplicada: totalCompensacionAplicada,
    total_modelo: totalModelo,
    suma_cargos: sumaCargos,
    diferencia_redondeo: round2(totalModelo - sumaCargos),
    cargos
  };
}

function buscarCargoAsociado(personaId, mes) {
  if (!personaId || !mes) return null;

  const cargoGuardado = state.cargos.find((cargo) => (
    cargo.mes === mes &&
    mismaPersona(cargo.persona_id, personaId) &&
    cargoEsVigente(cargo)
  ));
  if (cargoGuardado) return cargoConPersona(cargoGuardado);

  if (state.config) {
    const calculo = calcularCargosMensuales(state.config, state.personas, state.pagos, mes);
    const cargoCalculado = calculo.cargos.find((cargo) => mismaPersona(cargo.persona_id, personaId));
    if (cargoCalculado) return cargoCalculado;
  }

  if (state.calculo?.mes === mes) {
    const cargoCalculado = state.calculo.cargos.find((cargo) => mismaPersona(cargo.persona_id, personaId));
    if (cargoCalculado) return cargoCalculado;
  }

  return null;
}

function renderPagos() {
  const selectedConcepto = byId('filtro-pago-concepto').value;
  byId('pago-concepto').innerHTML = conceptoOptions('PAGO_COMPLETO_MES', { includePagoCompleto: true });
  byId('filtro-pago-concepto').innerHTML = `<option value="" ${selectedConcepto ? '' : 'selected'}>Todos</option>${conceptoOptions(selectedConcepto)}`;
  byId('pagos-table').innerHTML = renderPagosTable(pagosFiltrados(), state.personas);
}

function pagosPersonaMes(personaId, mes, concepto) {
  return round2(state.pagos
    .filter((pago) => (
      mismaPersona(pago.persona_id, personaId) &&
      pago.mes_aplicado === mes &&
      pago.concepto === concepto
    ))
    .reduce((total, pago) => total + Number(pago.monto || 0), 0));
}

function pagosPersonaMesConceptos(personaId, mes, conceptos) {
  return round2(state.pagos
    .filter((pago) => (
      mismaPersona(pago.persona_id, personaId) &&
      pago.mes_aplicado === mes &&
      conceptos.includes(pago.concepto)
    ))
    .reduce((total, pago) => total + Number(pago.monto || 0), 0));
}

function estadoPorPago(pagado, requerido, noAplica = false) {
  if (noAplica) return 'No aplica';
  if (requerido <= 0.009) return 'Pagado';
  if (pagado <= 0.009) return 'Pendiente';
  if (pagado + 0.01 < requerido) return 'Parcial';
  return 'Pagado';
}

function estadoEquipoCargo(cargo, pagadoEquipo) {
  const cargoEquipo = Number(cargo.cargo_equipo || 0);
  if (cargoEquipo > 0) return estadoPorPago(pagadoEquipo, cargoEquipo);

  const persona = state.personas.find((item) => mismaPersona(item.id, cargo.persona_id)) || cargo.persona;
  const pagosEquipo = state.pagos.filter((pago) => (
    mismaPersona(pago.persona_id, cargo.persona_id) &&
    ['COMPRA_INICIAL', 'REGULARIZACION'].includes(pago.concepto)
  ));
  const totalPagadoEquipo = round2(pagosEquipo.reduce((total, pago) => total + Number(pago.monto || 0), 0));
  const tieneSaldoAFavor = Number(cargo.compensacion_aplicada || 0) > 0 ||
    Number(cargo.saldo_compensatorio || 0) > 0 ||
    Number(cargo.saldo_favor_proximo_mes || 0) > 0 ||
    observacionCargo(cargo).toLowerCase().includes('saldo a favor');
  const personaActiva = persona?.estado === 'ACTIVO';
  const esFundador = persona?.es_fundador === true;

  if (personaActiva && esFundador) return 'Pagado';

  if (personaActiva && (tieneSaldoAFavor || totalPagadoEquipo > 0)) {
    return 'Pagado';
  }

  return 'No aplica';
}

function estadoClass(estado) {
  return estado
    .toLowerCase()
    .replace(/\s+/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatARSNegativoVisual(value) {
  const amount = Math.abs(Number(value || 0));
  return amount > 0 ? `-${formatARS(amount)}` : formatARS(0);
}

function formatMesCuenta(mes) {
  return String(mes || currentMonth()).replace('-', '/');
}

function cuentaStatusClass(estado) {
  if (estado === 'Al día') return 'account-status-ok';
  if (estado === 'Saldo a favor') return 'account-status-credit';
  if (estado === 'Parcial') return 'account-status-partial';
  if (estado === 'Pendiente') return 'account-status-due';
  return 'account-status-empty';
}

function observacionCargo(cargo) {
  const partes = [];

  if (cargo.concepto_equipo === 'COMPRA_INICIAL') {
    partes.push('Compra inicial + abono mensual');
  } else if (cargo.concepto_equipo === 'REGULARIZACION') {
    partes.push('Regularizacion proporcional + abono mensual');
  } else if (Number(cargo.compensacion_aplicada || 0) > 0) {
    partes.push('Cuota reducida por saldo a favor');
  } else {
    partes.push('Cuota mensual');
  }

  if (Number(cargo.ajuste_redondeo || 0) !== 0 || String(cargo.concepto || '').includes('Ajuste de redondeo')) {
    partes.push('Ajuste de redondeo aplicado');
  }

  const saldoProximoMes = round2(Math.max(0, Number(cargo.saldo_compensatorio || 0) - Number(cargo.compensacion_aplicada || 0)));
  if (saldoProximoMes > 0) {
    partes.push(`Saldo a favor proximo mes: ${formatARSNegativoVisual(saldoProximoMes)}`);
  }

  return partes.join('. ');
}

function estadoCuentaCargo(cargo) {
  const pagadoEquipoMes = pagosPersonaMesConceptos(cargo.persona_id, cargo.mes, ['COMPRA_INICIAL', 'REGULARIZACION']);
  const pagadoAbonoMes = pagosPersonaMes(cargo.persona_id, cargo.mes, 'ABONO');
  const totalAjuste = pagosPersonaMes(cargo.persona_id, cargo.mes, 'AJUSTE');
  const equipoDelMes = round2(Math.max(0, Number(cargo.cargo_equipo ?? cargo.regularizacion_aplicada ?? 0), pagadoEquipoMes));
  const abonoDelMes = round2(Math.max(0, Number(cargo.abono_base || 0), pagadoAbonoMes));
  const compensacionAplicada = round2(Math.max(0, Number(cargo.compensacion_aplicada || 0)));
  const totalDelMes = round2(Math.max(equipoDelMes + abonoDelMes - compensacionAplicada, 0));
  const pagadoSinAjuste = round2(pagadoEquipoMes + pagadoAbonoMes);
  const pagado = round2(pagadoSinAjuste + totalAjuste);
  const pendiente = pagadoSinAjuste + 0.01 >= totalDelMes ? 0 : round2(Math.max(totalDelMes - pagadoSinAjuste, 0));
  const saldoAFavor = totalAjuste > 0.01 ? totalAjuste : 0;
  let estado = 'Sin cargo';

  if (totalDelMes <= 0.01 && pagado <= 0.01) {
    estado = 'Sin cargo';
  } else if (pendiente <= 0.01 && totalAjuste > 0.01) {
    estado = 'Saldo a favor';
  } else if (pendiente <= 0.01) {
    estado = 'Al día';
  } else if (pagadoSinAjuste <= 0.01) {
    estado = 'Pendiente';
  } else {
    estado = 'Parcial';
  }

  return {
    pagadoEquipoMes,
    pagadoAbonoMes,
    equipoDelMes,
    abonoDelMes,
    totalDelMes,
    pagado,
    totalAjuste,
    pendiente,
    saldoAFavor,
    estado
  };
}

function observacionEstadoCuenta(cargo, cuenta) {
  let base = 'Cuota mensual';
  const conceptoEquipo = cargo.concepto_equipo || (
    cuenta.pagadoEquipoMes > 0 && pagosPersonaMes(cargo.persona_id, cargo.mes, 'REGULARIZACION') > 0 ? 'REGULARIZACION' : null
  );
  if (conceptoEquipo === 'COMPRA_INICIAL') {
    base = 'Compra inicial + abono mensual';
  } else if (conceptoEquipo === 'REGULARIZACION') {
    base = 'Regularizacion + abono mensual';
  } else if (cuenta.pagadoEquipoMes > 0) {
    base = 'Compra inicial + abono mensual';
  } else if (Number(cargo.compensacion_aplicada || 0) > 0) {
    base = 'Cuota reducida por saldo a favor';
  }

  if (cuenta.estado === 'Saldo a favor') {
    return `${base} pagados. Saldo a favor: ${formatARSNegativoVisual(cuenta.saldoAFavor)}`;
  }
  if (cuenta.estado === 'Al día') {
    return base === 'Cuota mensual' ? 'Cuota mensual pagada' : `${base} pagados`;
  }
  if (cuenta.estado === 'Parcial') {
    return `${base}. Pago parcial`;
  }
  if (cuenta.estado === 'Pendiente') {
    return `${base}. Pendiente de pago`;
  }
  return 'Sin cargo del mes';
}

function estadoCuentaDesdePagos(personaId, mes) {
  const pagadoEquipoMes = pagosPersonaMesConceptos(personaId, mes, ['COMPRA_INICIAL', 'REGULARIZACION']);
  const pagadoAbonoMes = pagosPersonaMes(personaId, mes, 'ABONO');
  const totalAjuste = pagosPersonaMes(personaId, mes, 'AJUSTE');
  const pagadoSinAjuste = round2(pagadoEquipoMes + pagadoAbonoMes);
  const pagado = round2(pagadoSinAjuste + totalAjuste);
  const tienePagos = pagado > 0.01;
  const estado = !tienePagos
    ? 'Sin cargo'
    : totalAjuste > 0.01
      ? 'Saldo a favor'
      : 'Al día';
  const observaciones = [];

  if (!tienePagos) {
    observaciones.push('No hay cargo mensual guardado para este mes.');
  } else if (pagadoEquipoMes > 0.01 && pagadoAbonoMes > 0.01) {
    observaciones.push('Compra inicial / regularizacion + abono registrados.');
  } else if (pagadoEquipoMes > 0.01) {
    observaciones.push('Pago de equipo registrado.');
  } else if (pagadoAbonoMes > 0.01) {
    observaciones.push('Cuota mensual registrada.');
  } else {
    observaciones.push('Estado calculado segun pagos registrados del mes.');
  }

  if (totalAjuste > 0.01) {
    observaciones.push('Saldo a favor registrado.');
  }

  return {
    pagadoEquipoMes,
    pagadoAbonoMes,
    equipoDelMes: pagadoEquipoMes,
    abonoDelMes: pagadoAbonoMes,
    totalDelMes: pagadoSinAjuste,
    pagado,
    totalAjuste,
    pendiente: 0,
    saldoAFavor: totalAjuste > 0.01 ? totalAjuste : 0,
    estado,
    observacion: observaciones.join(' ')
  };
}

function calculoGuardadoVisible(mes) {
  if (!mes) return null;
  const cierre = state.cierres.find((item) => item.mes === mes && item.estado !== 'ANULADO');
  if (!cierre) return null;
  const tieneCargos = state.cargos.some((cargo) => cargo.cierre_mensual_id === cierre.id && cargoEsVigente(cargo));
  return tieneCargos ? calculoGuardadoPorMes(cierre) : null;
}

function renderCargosTable(resultado, readonly = false) {
  if (!resultado || !resultado.cargos?.length) {
    return '<p class="muted">Calcula un mes para ver los cargos.</p>';
  }

  const rows = resultado.cargos.map((cargo) => {
    const cuenta = estadoCuentaCargo(cargo);
    const ajusteSaldo = cuenta.saldoAFavor > 0.01 ? cuenta.saldoAFavor : 0;
    const ajusteClass = ajusteSaldo > 0 ? 'saldo-favor' : 'valor-cero';

    return `
      <tr>
        <td>${escapeHtml(cargo.persona.nombre)}</td>
        <td class="number ${cuenta.equipoDelMes <= 0 ? 'money-muted' : ''}">${formatARS(cuenta.equipoDelMes)}</td>
        <td class="number ${cuenta.abonoDelMes <= 0 ? 'money-muted' : ''}">${formatARS(cuenta.abonoDelMes)}</td>
        <td class="number money-total">${formatARS(cuenta.totalDelMes)}</td>
        <td class="number ${cuenta.pagado <= 0 ? 'money-muted' : 'money-paid'}">${formatARS(cuenta.pagado)}</td>
        <td class="number ${ajusteClass}">${formatARSNegativoVisual(ajusteSaldo)}</td>
        <td class="number pending-today ${cuenta.pendiente <= 0 ? 'pending-ok' : 'pending-due'}">${formatARS(cuenta.pendiente)}</td>
        <td><span class="status-pill status-${estadoClass(cuenta.estado)}">${escapeHtml(cuenta.estado)}</span></td>
        <td>${escapeHtml(observacionEstadoCuenta(cargo, cuenta))}</td>
      </tr>
    `;
  });

  return `
    <div class="summary-line">
      <span>Abono mensual: <strong>${formatARS(resultado.total_abono_actualizado)}</strong></span>
      <span>Equipo del mes: <strong>${formatARS(resultado.total_cargo_equipo || 0)}</strong></span>
      <span>Compensación: <strong>${formatARS(resultado.total_compensacion_aplicada || 0)}</strong></span>
      <span>Total a cobrar: <strong>${formatARS(resultado.suma_cargos)}</strong></span>
      <span>Diferencia: <strong>${formatARS(resultado.diferencia_redondeo)}</strong></span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Persona</th>
          <th>Equipo del mes</th>
          <th>Abono del mes</th>
          <th>Total del mes</th>
          <th>Pagado</th>
          <th>Ajuste / saldo a favor</th>
          <th>Pendiente hoy</th>
          <th>Estado</th>
          <th>Observación</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${readonly || resultado.cerrado ? '' : '<button type="button" id="cerrar-mes-btn" class="primary">Cerrar mes</button>'}
  `;
}

function renderCalculo() {
  const mes = byId('calculo-mes')?.value || state.calculo?.mes;
  const resultado = calculoGuardadoVisible(mes) || state.calculo;
  byId('calculo-result').innerHTML = renderCargosTable(resultado, !isAdmin());
}

function cargosParaMensajes(mes) {
  const cargosGuardados = state.cargos
    .filter((cargo) => cargo.mes === mes && cargoEsVigente(cargo))
    .map(cargoConPersona)
    .filter((cargo) => cargo.persona);

  if (cargosGuardados.length > 0) return cargosGuardados;

  const calculo = calcularCargosMensuales(state.config, state.personas, state.pagos, mes);
  return calculo.cargos;
}

function renderMensajes() {
  byId('mensajes-list').innerHTML = '<p class="muted">Genera mensajes para el mes seleccionado.</p>';
}

function macsPersona(persona) {
  return [persona?.mac_1 || persona?.mac || '', persona?.mac_2 || '']
    .map((mac) => String(mac || '').trim())
    .filter(Boolean);
}

function totalPagadoCargoMes(personaId, mes) {
  const conceptos = ['COMPRA_INICIAL', 'REGULARIZACION', 'ABONO', 'AJUSTE'];
  return round2(state.pagos
    .filter((pago) => (
      mismaPersona(pago.persona_id, personaId) &&
      pago.mes_aplicado === mes &&
      conceptos.includes(pago.concepto)
    ))
    .reduce((total, pago) => total + Number(pago.monto || 0), 0));
}

function routerMonth() {
  return byId('router-mes')?.value || byId('calculo-mes')?.value || byId('mensajes-mes')?.value || currentMonth();
}

function routerItem(persona, mes) {
  const cargo = buscarCargoAsociado(persona.id, mes);
  const totalPagado = totalPagadoCargoMes(persona.id, mes);
  const montoAPagar = cargo ? round2(Number(cargo.monto_a_pagar || 0)) : 0;
  const pagoCompleto = Boolean(cargo) && (montoAPagar <= 0.009 || totalPagado + 0.01 >= montoAPagar);
  const routerEstado = persona.router_estado || 'BLOQUEADO';
  const macs = macsPersona(persona);
  const tieneMac = macs.length > 0;

  let prioridad = 5;
  let titulo = 'Sin pago completo y bloqueado';
  let descripcion = cargo ? 'Sin accion de router pendiente.' : 'Sin cargo vigente para el mes seleccionado.';

  if (pagoCompleto && !tieneMac) {
    prioridad = 3;
    titulo = 'PAGO Y FALTA MAC';
    descripcion = 'Pedir MAC antes de habilitar.';
  } else if (pagoCompleto && routerEstado === 'BLOQUEADO' && tieneMac) {
    prioridad = 1;
    titulo = 'PAGO Y ESTA BLOQUEADO';
    descripcion = 'Corresponde habilitar en el router.';
  } else if (!pagoCompleto && routerEstado === 'HABILITADO' && tieneMac) {
    prioridad = 2;
    titulo = 'NO PAGO Y ESTA HABILITADO';
    descripcion = 'Revisar y bloquear si corresponde.';
  } else if (pagoCompleto && routerEstado === 'HABILITADO' && tieneMac) {
    prioridad = 4;
    titulo = 'Correcto';
    descripcion = 'Pago completo, MAC cargada y router habilitado.';
  }

  return {
    persona,
    cargo,
    mes,
    totalPagado,
    montoAPagar,
    pagoCompleto,
    routerEstado,
    macs,
    tieneMac,
    prioridad,
    titulo,
    descripcion
  };
}

function renderRouterActions(item) {
  const id = escapeHtml(item.persona.id);
  const macButtons = item.macs
    .map((mac, index) => `<button type="button" data-copy-mac="${escapeHtml(mac)}">Copiar MAC ${index + 1}</button>`)
    .join('');
  const adminActions = isAdmin() ? [
    item.prioridad === 1 ? `<button type="button" class="primary" data-router-persona="${id}" data-router-estado="HABILITADO">Marcar habilitado</button>` : '',
    item.prioridad === 2 ? `<button type="button" class="danger" data-router-persona="${id}" data-router-estado="BLOQUEADO">Marcar bloqueado</button>` : '',
    item.prioridad === 3 ? `<button type="button" data-solicitar-mac="${id}">Solicitar MAC</button>` : '',
    item.prioridad === 3 ? `<button type="button" data-edit-router-persona="${id}">Editar persona</button>` : ''
  ].join('') : '';

  return [adminActions, macButtons].filter(Boolean).join(' ');
}

function renderRouter() {
  const mes = routerMonth();
  if (!mes) {
    byId('router-list').innerHTML = '<p class="muted">Seleccione o calcule un mes para gestionar el router.</p>';
    return;
  }

  const items = state.personas
    .filter((persona) => persona.estado === 'ACTIVO')
    .map((persona) => routerItem(persona, mes))
    .sort((a, b) => a.prioridad - b.prioridad || a.persona.nombre.localeCompare(b.persona.nombre));

  const resumen = {
    habilitar: items.filter((item) => item.prioridad === 1).length,
    bloquear: items.filter((item) => item.prioridad === 2).length,
    faltaMac: items.filter((item) => item.prioridad === 3).length,
    correctos: items.filter((item) => [4, 5].includes(item.prioridad)).length
  };

  const cards = items.map((item) => `
    <article class="router-card router-priority-${item.prioridad}">
      <header>
        <div>
          <strong>${escapeHtml(item.persona.nombre)}</strong>
          <span>${escapeHtml(item.titulo)}</span>
        </div>
        <span class="badge">${escapeHtml(item.routerEstado)}</span>
      </header>
      <div class="router-grid">
        <span>Mes <strong>${escapeHtml(item.mes)}</strong></span>
        <span>Total cargo <strong>${item.cargo ? formatARS(item.montoAPagar) : 'Sin cargo'}</strong></span>
        <span>Pagado <strong>${formatARS(item.totalPagado)}</strong></span>
        <span>MAC <strong>${escapeHtml(item.macs.join(' / ') || 'Falta MAC')}</strong></span>
      </div>
      <p class="muted">${escapeHtml(item.descripcion)}</p>
      <div class="router-actions">${renderRouterActions(item)}</div>
    </article>
  `);

  byId('router-list').innerHTML = `
    <div class="router-summary">
      <article><span>Para habilitar</span><strong>${resumen.habilitar}</strong></article>
      <article><span>Para bloquear</span><strong>${resumen.bloquear}</strong></article>
      <article><span>Falta MAC</span><strong>${resumen.faltaMac}</strong></article>
      <article><span>Correctos / sin accion</span><strong>${resumen.correctos}</strong></article>
    </div>
    <div class="router-list">${cards.join('') || '<p class="muted">No hay personas activas para gestionar.</p>'}</div>
  `;
}

function whatsappUrl(persona, mensaje) {
  const telefono = String(persona?.telefono_whatsapp || '').replace(/\D/g, '');
  if (!telefono || !mensaje) return '';
  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

function renderMoras() {
  const moras = calcularMoras(
    state.personas,
    state.cargos,
    state.pagos,
    state.config?.meses_mora_suspension || 3
  );

  const rows = moras.map((item) => `
    <tr>
      <td>${escapeHtml(item.persona.nombre)}</td>
      <td><span class="badge">${escapeHtml(item.persona.estado)}</span></td>
      <td class="number">${item.mesesImpagos}</td>
      <td class="number">${formatARS(item.deuda)}</td>
      <td>${item.sugerirSuspension ? 'Revisar suspension por mora' : 'Seguimiento'}</td>
      <td>${escapeHtml(item.persona.mac_1 || item.persona.mac || '')}</td>
    </tr>
  `);

  byId('moras-table').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Persona</th>
          <th>Estado</th>
          <th>Meses impagos</th>
          <th>Deuda registrada</th>
          <th>Referencia</th>
          <th>MAC</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || '<tr><td colspan="6">Sin moras registradas.</td></tr>'}</tbody>
    </table>
  `;
}

async function bootAuthenticated(session) {
  state.session = session;
  state.profile = await ensureUserProfile(state.supabase, session.user);
  byId('login-section').hidden = true;
  byId('app-shell').hidden = false;
  await loadData();
}

async function boot() {
  byId('dashboard-mes').value = currentMonth();
  byId('mi-cuenta-mes').value = currentMonth();
  byId('calculo-mes').value = currentMonth();
  byId('mensajes-mes').value = currentMonth();
  byId('router-mes').value = currentMonth();
  byId('filtro-pago-mes').value = currentMonth();
  byId('pago-form').elements.fecha_pago.value = new Date().toISOString().slice(0, 10);
  byId('pago-form').elements.mes_aplicado.value = currentMonth();

  bindEvents();

  try {
    state.supabase = await createSupabaseClient();
    const session = await getSession(state.supabase);
    if (session) {
      await bootAuthenticated(session);
    }
  } catch (error) {
    setError(error);
  }
}

function bindEvents() {
  byId('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      setLoading('Ingresando...');
      const { email, password } = formToObject(event.currentTarget);
      const { session } = await signIn(state.supabase, email, password);
      await bootAuthenticated(session);
      setOk('Sesion iniciada.');
    } catch (error) {
      setError(error);
    }
  });

  byId('signup-btn').addEventListener('click', async () => {
    try {
      setLoading('Creando cuenta...');
      const { email, password } = formToObject(byId('login-form'));
      const { user, session } = await signUp(state.supabase, email, password);
      if (session && user) {
        await bootAuthenticated(session);
        setOk('Cuenta creada. Quedo pendiente de vinculacion del administrador.');
        return;
      }
      setOk('Cuenta creada. Revisa tu email o espera activacion/vinculacion del administrador.');
    } catch (error) {
      setError(error);
    }
  });

  byId('logout-btn').addEventListener('click', async () => {
    try {
      await signOut(state.supabase);
      window.location.reload();
    } catch (error) {
      setError(error);
    }
  });

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => setSection(button.dataset.section));
  });

  byId('dashboard-mes').addEventListener('change', renderDashboard);
  byId('mi-cuenta-mes').addEventListener('change', renderMiCuenta);
  byId('router-mes').addEventListener('change', renderRouter);
  byId('filtro-pago-persona').addEventListener('change', renderPagos);
  byId('filtro-pago-mes').addEventListener('change', renderPagos);
  byId('filtro-pago-concepto').addEventListener('change', renderPagos);

  byId('config-form').addEventListener('submit', saveConfig);
  byId('persona-form').addEventListener('submit', savePersona);
  byId('persona-reset').addEventListener('click', resetPersonaForm);
  byId('personas-table').addEventListener('click', handlePersonaAction);
  byId('usuarios-table').addEventListener('change', handleUsuariosChange);
  byId('usuarios-table').addEventListener('click', handleUsuariosClick);
  byId('mi-cuenta-content').addEventListener('submit', handleMiCuentaComprobanteSubmit);
  byId('comprobantes-table').addEventListener('click', handleComprobantesAction);
  byId('comprobantes-table').addEventListener('submit', handleComprobantePagoSubmit);
  byId('pago-form').addEventListener('submit', savePago);
  byId('calcular-btn').addEventListener('click', calcularMes);
  byId('calculo-result').addEventListener('click', closeMonth);
  byId('generar-mensajes').addEventListener('click', generarMensajes);
  byId('mensajes-list').addEventListener('click', copyMessage);
  byId('router-list').addEventListener('click', handleRouterAction);
  byId('export-pagos-filtrados').addEventListener('click', () => exportPagos(pagosFiltrados(), 'pagos-filtrados.csv'));
  byId('export-personas').addEventListener('click', exportPersonas);
  byId('export-pagos').addEventListener('click', () => exportPagos(state.pagos, 'pagos.csv'));
  byId('export-cargos').addEventListener('click', exportCargos);
}

function safeStorageFileName(name) {
  return String(name || 'comprobante')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'comprobante';
}

function comprobanteStoragePath(personaId, mes, file) {
  const id = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${personaId}/${mes}/${Date.now()}-${id}-${safeStorageFileName(file.name)}`;
}

async function uploadComprobante({ personaId, mes, monto, observaciones, file }) {
  if (!personaId) throw new Error('Tu cuenta no esta vinculada a una persona.');
  if (!file) throw new Error('Selecciona un archivo de comprobante.');
  if (!MES_CIERRE_PATTERN.test(mes)) throw new Error('Selecciona un mes valido.');
  const montoInformado = monto === null || monto === '' ? null : normalizeNumber(monto);
  if (montoInformado !== null && montoInformado < 0) {
    throw new Error('El monto informado no puede ser negativo.');
  }

  const archivoPath = comprobanteStoragePath(personaId, mes, file);
  const { error: uploadError } = await state.supabase
    .storage
    .from('comprobantes-pago')
    .upload(archivoPath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
  if (uploadError) throw uploadError;

  const payload = {
    persona_id: personaId,
    mes_aplicado: mes,
    monto_informado: montoInformado,
    archivo_bucket: 'comprobantes-pago',
    archivo_path: archivoPath,
    archivo_nombre: file.name || 'comprobante',
    archivo_tipo: file.type || 'application/octet-stream',
    archivo_tamano: file.size || 0,
    estado: 'PENDIENTE',
    observaciones: observaciones?.trim() || null,
    created_by: state.session?.user?.id || null
  };

  const { error: insertError } = await state.supabase
    .from('comprobantes_pago')
    .insert(payload);
  if (insertError) throw insertError;
}

async function handleMiCuentaComprobanteSubmit(event) {
  if (event.target.id !== 'mi-cuenta-comprobante-form') return;
  event.preventDefault();

  if (!isUsuario() || !state.profile?.persona_id) {
    return setError('Tu cuenta no esta vinculada a una persona.');
  }

  const form = event.target;
  const file = form.elements.archivo.files?.[0] || null;
  const mes = form.elements.mes_aplicado.value;
  const monto = form.elements.monto_informado.value;
  const observaciones = form.elements.observaciones.value;

  try {
    setLoading('Subiendo comprobante...');
    await uploadComprobante({
      personaId: state.profile.persona_id,
      mes,
      monto,
      observaciones,
      file
    });
    form.reset();
    form.elements.mes_aplicado.value = mes;
    await loadData();
    setOk('Comprobante enviado. Queda pendiente de revision.');
  } catch (error) {
    setError(error);
  }
}

async function registrarPagoCompletoMes({ personaId, mes, monto, fechaPago, medio, observaciones }) {
  const montoPagado = normalizeNumber(monto);
  if (!personaId) throw new Error('Falta persona asociada al pago.');
  if (!MES_CIERRE_PATTERN.test(mes)) throw new Error('El mes aplicado no es valido.');
  if (!Number.isFinite(montoPagado) || montoPagado <= 0) throw new Error('El monto a registrar no es valido.');

  const cargoAsociado = buscarCargoAsociado(personaId, mes);
  if (!cargoAsociado) {
    throw new Error('Primero debe calcularse el mes o existir un cargo vigente para esta persona.');
  }

  const imputaciones = descomponerPagoSegunCargo(montoPagado, cargoAsociado);
  if (!imputaciones.length) throw new Error('No se generaron imputaciones para el pago.');

  const basePayload = {
    persona_id: personaId,
    fecha_pago: fechaPago,
    mes_aplicado: mes,
    medio: medio || 'TRANSFERENCIA',
    observaciones: observaciones?.trim() || null,
    created_by: state.session.user.id
  };
  const payload = imputaciones.map((imputacion) => ({
    ...basePayload,
    monto: imputacion.monto,
    concepto: imputacion.concepto,
    observaciones: imputacion.observaciones || basePayload.observaciones
  }));

  const { data, error } = await state.supabase
    .from('pagos')
    .insert(payload)
    .select('id');
  if (error) throw error;
  return data || [];
}

async function handleComprobantePagoSubmit(event) {
  if (event.target.id !== 'comprobante-pago-form') return;
  event.preventDefault();

  if (!isAdmin()) return setError('Solo ADMIN puede registrar pagos desde comprobantes.');

  const raw = formToObject(event.target);
  const comprobante = state.comprobantes.find((item) => item.id === raw.comprobante_id);
  if (!comprobante) return setError('No se encontro el comprobante.');
  if ((comprobante.estado || 'PENDIENTE') !== 'PENDIENTE') {
    return setError('Solo se pueden procesar comprobantes pendientes.');
  }
  if (!comprobante.persona_id || !comprobante.mes_aplicado) {
    return setError('El comprobante no tiene persona o mes aplicado valido.');
  }

  const monto = normalizeNumber(raw.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return setError('El monto a registrar no es valido.');
  }

  const persona = state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id));
  const mensaje = `Registrar pago de ${formatARS(monto)} para ${persona?.nombre || 'esta persona'} en ${comprobante.mes_aplicado}?`;
  if (!confirm(mensaje)) return;

  try {
    setLoading('Registrando pago desde comprobante...');
    const observaciones = raw.observaciones?.trim()
      || `Registrado desde comprobante ${comprobante.archivo_nombre || comprobante.id}`;
    const pagosCreados = await registrarPagoCompletoMes({
      personaId: comprobante.persona_id,
      mes: comprobante.mes_aplicado,
      monto,
      fechaPago: raw.fecha_pago,
      medio: raw.medio || 'TRANSFERENCIA',
      observaciones
    });
    const pagoIds = pagosCreados.map((pago) => pago.id).filter(Boolean);
    const { error: updateError } = await state.supabase
      .from('comprobantes_pago')
      .update({
        estado: 'PROCESADO',
        revisado_at: new Date().toISOString(),
        revisado_by: state.session?.user?.id || null,
        pago_ids: pagoIds
      })
      .eq('id', comprobante.id)
      .eq('estado', 'PENDIENTE')
      .select('id')
      .single();
    if (updateError) {
      throw new Error(`Los pagos se crearon, pero no se pudo marcar el comprobante como PROCESADO: ${updateError.message}`);
    }

    state.comprobanteProcesandoId = null;
    state.comprobantesFiltro = 'PROCESADO';
    await loadData();
    setOk('Pago registrado y comprobante marcado como PROCESADO.');
  } catch (error) {
    setError(error);
  }
}

async function handleComprobantesAction(event) {
  const filter = event.target.dataset.comprobanteFilter;
  const viewId = event.target.dataset.comprobanteView;
  const discardId = event.target.dataset.comprobanteDiscard;
  const registerId = event.target.dataset.comprobanteRegister;
  const cancelProcess = event.target.dataset.comprobanteProcessCancel !== undefined;

  if (filter) {
    state.comprobantesFiltro = filter;
    state.comprobanteProcesandoId = null;
    renderComprobantes();
    return;
  }

  if (cancelProcess) {
    state.comprobanteProcesandoId = null;
    renderComprobantes();
    return;
  }

  if (registerId && isAdmin()) {
    const comprobante = state.comprobantes.find((item) => item.id === registerId);
    if (!comprobante) return setError('No se encontro el comprobante.');
    if ((comprobante.estado || 'PENDIENTE') !== 'PENDIENTE') {
      return setError('Solo se pueden procesar comprobantes pendientes.');
    }
    state.comprobanteProcesandoId = registerId;
    renderComprobantes();
    return;
  }

  if (viewId) {
    const comprobante = state.comprobantes.find((item) => item.id === viewId);
    if (!comprobante) return;
    try {
      const { data, error } = await state.supabase
        .storage
        .from(comprobante.archivo_bucket || 'comprobantes-pago')
        .createSignedUrl(comprobante.archivo_path, 60 * 10);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setError(error);
    }
  }

  if (discardId && isAdmin()) {
    const comprobante = state.comprobantes.find((item) => item.id === discardId);
    if (!confirm(`Descartar comprobante de ${comprobante?.archivo_nombre || 'archivo'}?`)) return;
    try {
      const { error } = await state.supabase
        .from('comprobantes_pago')
        .update({
          estado: 'DESCARTADO',
          revisado_at: new Date().toISOString(),
          revisado_by: state.session?.user?.id || null
        })
        .eq('id', discardId);
      if (error) throw error;
      if (state.comprobanteProcesandoId === discardId) {
        state.comprobanteProcesandoId = null;
      }
      await loadData();
      setOk('Comprobante descartado.');
    } catch (error) {
      setError(error);
    }
  }
}

async function saveConfig(event) {
  event.preventDefault();
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');

  const raw = formToObject(event.currentTarget);
  const payload = {
    compra_equipo: normalizeNumber(raw.compra_equipo),
    recargo_compra_pct: normalizeNumber(raw.recargo_compra_pct),
    abono_mensual: normalizeNumber(raw.abono_mensual),
    recargo_abono_pct: normalizeNumber(raw.recargo_abono_pct),
    fundadores_iniciales: Number(raw.fundadores_iniciales),
    meses_mora_suspension: Number(raw.meses_mora_suspension),
    alias_bancario: raw.alias_bancario?.trim() || null,
    metodo_equilibrio: 'RAPIDO'
  };

  try {
    const request = state.config?.id
      ? state.supabase.from('app_config').update(payload).eq('id', state.config.id)
      : state.supabase.from('app_config').insert(payload);
    const { error } = await request;
    if (error) throw error;
    await loadData();
    setOk('Configuracion guardada.');
  } catch (error) {
    setError(error);
  }
}

function resetPersonaForm() {
  const form = byId('persona-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.estado.value = 'ACTIVO';
  form.elements.router_estado.value = 'BLOQUEADO';
}

async function savePersona(event) {
  event.preventDefault();
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');

  const form = event.currentTarget;
  const raw = formToObject(form);
  const payload = {
    nombre: raw.nombre.trim(),
    dependencia: raw.dependencia?.trim() || null,
    estado: raw.estado,
    es_fundador: form.elements.es_fundador.checked,
    fecha_ingreso: raw.fecha_ingreso || null,
    telefono_whatsapp: raw.telefono_whatsapp?.trim() || null,
    mac: raw.mac_1?.trim() || null,
    mac_1: raw.mac_1?.trim() || null,
    mac_2: raw.mac_2?.trim() || null,
    router_estado: raw.router_estado || 'BLOQUEADO',
    observaciones: raw.observaciones?.trim() || null
  };

  try {
    const request = raw.id
      ? state.supabase.from('personas').update(payload).eq('id', raw.id)
      : state.supabase.from('personas').insert(payload);
    const { error } = await request;
    if (error) throw error;
    resetPersonaForm();
    await loadData();
    setOk('Persona guardada.');
  } catch (error) {
    setError(error);
  }
}

function focusPersonaForm() {
  const form = byId('persona-form');
  if (form) {
    form.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  const nombreInput = byId('persona-nombre');
  if (nombreInput) {
    setTimeout(() => nombreInput.focus(), 300);
  }
}

function editPersona(personaId) {
  const persona = state.personas.find((item) => mismaPersona(item.id, personaId));
  if (!persona) return;
  const form = byId('persona-form');
  form.elements.id.value = persona.id;
  form.elements.nombre.value = persona.nombre || '';
  form.elements.dependencia.value = persona.dependencia || '';
  form.elements.estado.value = persona.estado || 'ACTIVO';
  form.elements.fecha_ingreso.value = persona.fecha_ingreso || '';
  form.elements.telefono_whatsapp.value = persona.telefono_whatsapp || '';
  form.elements.mac_1.value = persona.mac_1 || persona.mac || '';
  form.elements.mac_2.value = persona.mac_2 || '';
  form.elements.router_estado.value = persona.router_estado || 'BLOQUEADO';
  form.elements.es_fundador.checked = Boolean(persona.es_fundador);
  form.elements.observaciones.value = persona.observaciones || '';
  setSection('personas');
  focusPersonaForm();
}

async function handlePersonaAction(event) {
  const editId = event.target.dataset.editPersona;
  const deleteId = event.target.dataset.deletePersona;

  if (editId) {
    editPersona(editId);
  }

  if (deleteId && isAdmin()) {
    const persona = state.personas.find((item) => item.id === deleteId);
    if (!confirm(`Dar de baja a ${persona?.nombre || 'esta persona'}?`)) return;
    try {
      const { error } = await state.supabase
        .from('personas')
        .update({ estado: 'BAJA_DEFINITIVA' })
        .eq('id', deleteId);
      if (error) throw error;
      await loadData();
      setOk('Persona dada de baja correctamente.');
    } catch (error) {
      setError(error);
    }
  }
}

async function updateProfile(profileId, patch, okMessage) {
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');
  try {
    const { error } = await state.supabase
      .from('profiles')
      .update(patch)
      .eq('id', profileId);
    if (error) throw error;
    await loadData();
    setSection('usuarios');
    setOk(okMessage);
  } catch (error) {
    setError(error);
  }
}

async function handleUsuariosChange(event) {
  const roleId = event.target.dataset.userRole;
  const activeId = event.target.dataset.userActive;
  const personaId = event.target.dataset.userPersona;

  if (roleId) {
    await updateProfile(roleId, { rol: event.target.value }, 'Rol actualizado.');
    return;
  }

  if (activeId) {
    await updateProfile(activeId, { activo: event.target.checked }, 'Estado de usuario actualizado.');
    return;
  }

  if (personaId) {
    await updateProfile(personaId, { persona_id: event.target.value || null }, 'Persona vinculada.');
  }
}

async function handleUsuariosClick(event) {
  const unlinkId = event.target.dataset.userUnlink;
  if (!unlinkId) return;
  await updateProfile(unlinkId, { persona_id: null }, 'Persona desvinculada.');
}

async function savePago(event) {
  event.preventDefault();
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');

  const form = event.currentTarget || byId('pago-form');
  if (!form) return setError('No se encontro el formulario de pagos.');

  const raw = formToObject(form);
  const basePayload = {
    persona_id: raw.persona_id,
    fecha_pago: raw.fecha_pago,
    mes_aplicado: raw.mes_aplicado,
    medio: raw.medio || 'TRANSFERENCIA',
    observaciones: raw.observaciones?.trim() || null,
    created_by: state.session.user.id
  };

  try {
    const montoPagado = normalizeNumber(raw.monto);
    const pagoCompletoMes = raw.concepto === 'PAGO_COMPLETO_MES';
    const cargoAsociado = pagoCompletoMes
      ? buscarCargoAsociado(raw.persona_id, raw.mes_aplicado)
      : null;
    if (pagoCompletoMes && !cargoAsociado) {
      throw new Error('Primero debe calcularse el mes o existir un cargo vigente para esta persona.');
    }

    const imputaciones = pagoCompletoMes
      ? descomponerPagoSegunCargo(montoPagado, cargoAsociado)
      : [{ concepto: raw.concepto, monto: montoPagado }];
    const payload = imputaciones.map((imputacion) => ({
      ...basePayload,
      monto: imputacion.monto,
      concepto: imputacion.concepto,
      observaciones: imputacion.observaciones || basePayload.observaciones
    }));

    const { error } = await state.supabase.from('pagos').insert(payload);
    if (error) throw error;
    form.reset();
    form.elements.fecha_pago.value = new Date().toISOString().slice(0, 10);
    form.elements.mes_aplicado.value = currentMonth();
    form.elements.medio.value = 'TRANSFERENCIA';
    await loadData();
    setOk('Pago registrado.');
  } catch (error) {
    setError(error);
  }
}

function calcularMes() {
  try {
    const mes = byId('calculo-mes').value;
    if (!mes) throw new Error('Selecciona un mes.');
    if (!validarMesCierre(mes)) throw new Error('El mes debe tener formato YYYY-MM.');
    if (!state.config) throw new Error('Falta configuracion inicial.');
    const cierreCerrado = cierrePorMes(mes, 'CERRADO');
    if (cierreCerrado) {
      state.calculo = calculoGuardadoPorMes(cierreCerrado);
      renderCalculo();
      return setError('El mes ya está cerrado y no puede recalcularse.');
    }
    state.calculo = calcularCargosMensuales(state.config, state.personas, state.pagos, mes);
    renderCalculo();
    setOk('Cargos calculados.');
  } catch (error) {
    setError(error);
  }
}

async function obtenerCierrePorMes(mes) {
  const { data, error } = await state.supabase
    .from('cierres_mensuales')
    .select('*')
    .eq('mes', mes)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function crearCierreAbierto(calculo) {
  const { data, error } = await state.supabase
    .from('cierres_mensuales')
    .insert({
      mes: calculo.mes,
      total_equipo_actualizado: calculo.total_equipo_actualizado,
      total_abono_actualizado: calculo.total_abono_actualizado,
      usuarios_activos: calculo.usuarios_activos,
      estado: 'ABIERTO',
      cerrado_por: null
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function guardarCargosDeCierre(cierre, calculo) {
  const { data: cargosExistentesData, error: cargosError } = await state.supabase
    .from('cargos_mensuales')
    .select('*')
    .eq('cierre_mensual_id', cierre.id);

  if (cargosError) throw cargosError;

  const cargosExistentes = cargosExistentesData || [];
  const disponibles = cargosExistentes.slice();
  const insertPayload = [];
  const updateRequests = [];

  for (const cargo of calculo.cargos) {
    const payload = cargoPayload(cierre.id, cargo);
    const existingIndex = disponibles.findIndex((item) => String(item.persona_id) === String(cargo.persona_id));

    if (existingIndex === -1) {
      insertPayload.push(payload);
      continue;
    }

    const [existing] = disponibles.splice(existingIndex, 1);
    updateRequests.push(
      state.supabase
        .from('cargos_mensuales')
        .update({
          mes: payload.mes,
          abono_base: payload.abono_base,
          cargo_equipo: payload.cargo_equipo,
          concepto_equipo: payload.concepto_equipo,
          compensacion_aplicada: payload.compensacion_aplicada,
          monto_a_pagar: payload.monto_a_pagar,
          concepto: payload.concepto,
          saldo_equipo_antes: payload.saldo_equipo_antes,
          saldo_equipo_despues: payload.saldo_equipo_despues,
          pagado: payload.pagado
        })
        .eq('id', existing.id)
    );
  }

  for (const leftover of disponibles) {
    updateRequests.push(
      state.supabase
        .from('cargos_mensuales')
        .update({
          abono_base: 0,
          cargo_equipo: 0,
          concepto_equipo: null,
          compensacion_aplicada: 0,
          monto_a_pagar: 0,
          concepto: 'Cargo reemplazado antes del cierre',
          saldo_equipo_antes: 0,
          saldo_equipo_despues: 0,
          pagado: false
        })
        .eq('id', leftover.id)
    );
  }

  const updateResults = await Promise.all(updateRequests);
  for (const result of updateResults) {
    if (result.error) throw result.error;
  }

  if (insertPayload.length > 0) {
    const { error } = await state.supabase.from('cargos_mensuales').insert(insertPayload);
    if (error) throw error;
  }
}

async function marcarCierreComoCerrado(cierre, calculo) {
  const { data, error } = await state.supabase
    .from('cierres_mensuales')
    .update({
      total_equipo_actualizado: calculo.total_equipo_actualizado,
      total_abono_actualizado: calculo.total_abono_actualizado,
      usuarios_activos: calculo.usuarios_activos,
      estado: 'CERRADO',
      cerrado_por: state.session.user.id
    })
    .eq('id', cierre.id)
    .neq('estado', 'CERRADO')
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('El mes ya está cerrado y no puede recalcularse.');
  return data;
}

async function closeMonth(event) {
  if (event.target.id !== 'cerrar-mes-btn') return;
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');
  if (!state.calculo) return setError('Primero calcula el mes.');
  if (cierrePorMes(state.calculo.mes, 'CERRADO')) {
    return setError('El mes ya está cerrado y no puede recalcularse.');
  }
  if (Math.abs(diferenciaTotalMensual(state.calculo)) > CIERRE_MENSUAL_TOLERANCIA) {
    return setError('La suma de cargos no coincide con el total mensual.');
  }

  try {
    setLoading('Cerrando mes...');
    const cierreActual = await obtenerCierrePorMes(state.calculo.mes);
    if (cierreActual?.estado === 'CERRADO') {
      return setError('El mes ya está cerrado y no puede recalcularse.');
    }

    const cierre = cierreActual || await crearCierreAbierto(state.calculo);
    await guardarCargosDeCierre(cierre, state.calculo);
    await marcarCierreComoCerrado(cierre, state.calculo);

    await loadData();
    setOk('Cierre mensual guardado correctamente.');
  } catch (error) {
    setError(error);
  }
}

function generarMensajes() {
  try {
    const mes = byId('mensajes-mes').value;
    if (!mes) throw new Error('Selecciona un mes.');
    const mensajes = [
      ...cargosParaMensajes(mes).map((cargo) => ({ persona: cargo.persona, cargo })),
      ...state.personas
        .filter((persona) => persona.estado === 'SUSPENDIDO_MORA')
        .map((persona) => ({ persona, cargo: null }))
    ];
    const cards = mensajes.map(({ persona, cargo }) => {
      const text = mensajePorCargo(persona, cargo, mes, state.config?.alias_bancario);
      if (!text) return '';
      const montoAPagar = Number(cargo?.monto_a_pagar || 0);
      const urlWhatsapp = montoAPagar > 0 ? whatsappUrl(persona, text) : '';
      return `
        <article class="message-item">
          <header>
            <strong>${escapeHtml(persona.nombre)}</strong>
            <div class="message-actions">
              ${urlWhatsapp ? `<button type="button" data-open-whatsapp="${escapeHtml(urlWhatsapp)}">Abrir WhatsApp</button>` : ''}
              <button type="button" data-copy-message="${escapeHtml(text)}">Copiar</button>
            </div>
          </header>
          <pre>${escapeHtml(text)}</pre>
        </article>
      `;
    }).filter(Boolean);
    byId('mensajes-list').innerHTML = cards.join('') || '<p class="muted">No hay mensajes para este mes.</p>';
  } catch (error) {
    setError(error);
  }
}

async function copyMessage(event) {
  const whatsapp = event.target.dataset.openWhatsapp;
  if (whatsapp) {
    window.open(whatsapp, '_blank', 'noopener,noreferrer');
    return;
  }

  const text = event.target.dataset.copyMessage;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setOk('Mensaje copiado.');
  } catch (error) {
    setError('No se pudo copiar el mensaje.');
  }
}

async function copyTextToClipboard(text, okMessage, errorMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setOk(okMessage);
  } catch (error) {
    setError(errorMessage);
  }
}

async function handleRouterAction(event) {
  const copyMac = event.target.dataset.copyMac;
  const solicitarMac = event.target.dataset.solicitarMac;
  const editRouterPersona = event.target.dataset.editRouterPersona;
  const routerPersona = event.target.dataset.routerPersona;
  const routerEstado = event.target.dataset.routerEstado;

  if (copyMac) {
    await copyTextToClipboard(copyMac, 'MAC copiada.', 'No se pudo copiar la MAC.');
    return;
  }

  if (solicitarMac) {
    await copyTextToClipboard(
      'Hola, necesito que me pases la MAC del dispositivo para habilitarte el acceso al Starlink.',
      'Mensaje para solicitar MAC copiado.',
      'No se pudo copiar el mensaje.'
    );
    return;
  }

  if (editRouterPersona) {
    editPersona(editRouterPersona);
    return;
  }

  if (routerPersona && routerEstado && isAdmin()) {
    try {
      const { error } = await state.supabase
        .from('personas')
        .update({ router_estado: routerEstado })
        .eq('id', routerPersona);
      if (error) throw error;
      await loadData();
      setSection('router');
      setOk(`Estado router actualizado a ${routerEstado}.`);
    } catch (error) {
      setError(error);
    }
  }
}

function exportPersonas() {
  downloadCsv('personas.csv', [
    ['id', 'nombre', 'dependencia', 'estado', 'es_fundador', 'fecha_ingreso', 'telefono_whatsapp', 'mac_1', 'mac_2', 'mac', 'router_estado', 'observaciones'],
    ...state.personas.map((persona) => [
      persona.id,
      persona.nombre,
      persona.dependencia,
      persona.estado,
      persona.es_fundador,
      persona.fecha_ingreso,
      persona.telefono_whatsapp,
      persona.mac_1,
      persona.mac_2,
      persona.mac,
      persona.router_estado,
      persona.observaciones
    ])
  ]);
}

function exportPagos(pagos, filename) {
  downloadCsv(filename, [
    ['id', 'persona_id', 'fecha_pago', 'monto', 'concepto', 'mes_aplicado', 'medio', 'observaciones'],
    ...pagos.map((pago) => [
      pago.id,
      pago.persona_id,
      pago.fecha_pago,
      pago.monto,
      pago.concepto,
      pago.mes_aplicado,
      pago.medio,
      pago.observaciones
    ])
  ]);
}

function exportCargos() {
  downloadCsv('cargos.csv', [
    ['id', 'persona_id', 'mes', 'monto_a_pagar', 'concepto', 'saldo_equipo_antes', 'saldo_equipo_despues', 'pagado'],
    ...state.cargos.map((cargo) => [
      cargo.id,
      cargo.persona_id,
      cargo.mes,
      cargo.monto_a_pagar,
      cargo.concepto,
      cargo.saldo_equipo_antes,
      cargo.saldo_equipo_despues,
      cargo.pagado
    ])
  ]);
}

boot();
