import { createSupabaseClient, ensureUserProfile, getSession, signIn, signOut, signUp } from './auth.js';
import {
  calcularCargosMensuales,
  calcularMoras,
  totalAbonoActualizado,
  totalEquipoActualizado
} from './calculos.js';
import { mensajePorCargo } from './mensajes.js';
import { conceptoOptions, descomponerPagoSegunCargo, renderPagosTable } from './pagos.js';
import { estadoOptions, personaOptions, renderPersonasTable } from './personas.js';
import {
  byId,
  currentMonth,
  escapeHtml,
  formToObject,
  formatARS,
  normalizeNumber,
  round2,
  showNotice
} from './utils.js';

const CIERRE_MENSUAL_TOLERANCIA = 0.01;
const MES_CIERRE_PATTERN = /^\d{4}-\d{2}$/;

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[";\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function rowsToCsv(rows) {
  return `\ufeff${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}`;
}

function downloadCsv(filename, rows) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function asciiGeneratedText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('\u00c3\u00a1', 'a')
    .replaceAll('\u00c3\u00a9', 'e')
    .replaceAll('\u00c3\u00ad', 'i')
    .replaceAll('\u00c3\u00b3', 'o')
    .replaceAll('\u00c3\u00ba', 'u')
    .replaceAll('\u00c3\u00b1', 'n');
}

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
  comprobantesPagoEnProceso: new Set(),
  calculo: null,
  calculosRpcRaw: {},
  calculosRpc: {}
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
      ? ['dashboard', 'panel-mensual', 'cierre-mensual', 'config', 'usuarios', 'personas', 'pagos', 'comprobantes', 'calculo', 'mensajes', 'router', 'moras', 'exportacion']
      : ['dashboard', 'panel-mensual', 'cierre-mensual', 'config', 'personas', 'pagos', 'comprobantes', 'calculo', 'mensajes', 'router', 'moras', 'exportacion'];

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
  state.calculosRpcRaw = {};
  state.calculosRpc = {};

  renderAll();
  showNotice('', 'info');
}

function renderAll() {
  applyAccess();
  renderConfig();
  renderUsuarios();
  renderPanelMensual();
  renderCierreMensual();
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

async function renderDashboard() {
  const mes = byId('dashboard-mes').value || currentMonth();
  const container = byId('dashboard-cards');
  const activos = state.personas.filter((persona) => persona.estado === 'ACTIVO');
  const metricsBase = [
    ['Usuarios activos', activos.length],
    ['Fundadores activos', activos.filter((persona) => persona.es_fundador).length],
    ['Ingresantes posteriores activos', activos.filter((persona) => !persona.es_fundador).length],
    ['Pendientes de vinculacion/alta', state.personas.filter((persona) => persona.estado === 'PENDIENTE').length],
    ['Suspendidos por mora', state.personas.filter((persona) => persona.estado === 'SUSPENDIDO_MORA').length],
    ['Bajas definitivas', state.personas.filter((persona) => persona.estado === 'BAJA_DEFINITIVA').length]
  ];

  try {
    const calculo = await obtenerCalculoMensualEstado(mes);
    const cuentas = calculo.cargos.map((cargo) => estadoCuentaCargo(cargo));
    const totalMes = round2(cuentas.reduce((total, cuenta) => total + Number(cuenta.totalDelMes || 0), 0));
    const totalPagado = round2(cuentas.reduce((total, cuenta) => total + Number(cuenta.pagado || 0), 0));
    const totalPendiente = round2(cuentas.reduce((total, cuenta) => total + Number(cuenta.pendiente || 0), 0));
    const totalSaldoFavor = round2(cuentas.reduce((total, cuenta) => total + Number(cuenta.saldoAFavor || 0), 0));
    const personasConDeuda = cuentas.filter((cuenta) => cuenta.pendiente > 0.01).length;
    const personasAlDia = cuentas.filter((cuenta) => cuenta.pendiente <= 0.01 && cuenta.estado !== 'Sin cargo').length;
    const personasSaldoFavor = cuentas.filter((cuenta) => cuenta.saldoAFavor > 0.01).length;

    const metrics = [
      ...metricsBase,
      ['Total cargos del mes', formatARS(totalMes)],
      ['Total pagado del mes', formatARS(totalPagado)],
      ['Pendiente hoy', formatARS(totalPendiente)],
      ['Saldo a favor', formatARSNegativoVisual(totalSaldoFavor)],
      ['Personas con deuda', personasConDeuda],
      ['Personas al dia', personasAlDia],
      ['Personas con saldo a favor', personasSaldoFavor]
    ];

    container.innerHTML = metrics
      .map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`)
      .join('');
  } catch (error) {
    container.innerHTML = [
      ...metricsBase,
      ['Estado mensual', 'No disponible']
    ]
      .map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`)
      .join('');
    setError(error);
  }
}

function panelMonth() {
  return byId('panel-mes')?.value
    || byId('calculo-mes')?.value
    || byId('dashboard-mes')?.value
    || byId('router-mes')?.value
    || byId('mensajes-mes')?.value
    || currentMonth();
}

function cierreMonth() {
  return byId('cierre-mes')?.value
    || byId('panel-mes')?.value
    || byId('calculo-mes')?.value
    || byId('dashboard-mes')?.value
    || currentMonth();
}

function cuentaOperativaPersona(persona, mes) {
  const cargo = cargoMensualPersona(persona.id, mes);
  const cuenta = cargo ? estadoCuentaCargo(cargo) : estadoCuentaDesdePagos(persona.id, mes);
  return cuentaOperativaDesdeCuenta(persona, mes, cargo, cuenta);
}

function cuentaOperativaDesdeCuenta(persona, mes, cargo, cuenta) {
  const pagosDelMes = pagosExistentesPersonaMes(persona.id, mes);
  const tieneMac = macsPersona(persona).length > 0;
  const routerEstado = persona.router_estado || 'BLOQUEADO';
  const estado = cuenta.estado || 'Sin cargo';
  const pendiente = round2(Number(cuenta.pendiente || 0));
  const pagado = round2(Number(cuenta.pagado || 0));
  const totalDelMes = round2(Number(cuenta.totalDelMes || 0));
  const conDeuda = pendiente > 0.01;
  const sinCargo = estado === 'Sin cargo' || (totalDelMes <= 0.01 && pagado <= 0.01);
  const alDia = !conDeuda && !sinCargo;
  const pagoParcial = estado === 'Parcial';
  const saldoFavorVisual = round2(Number(cuenta.saldoAFavor || cuenta.totalAjuste || 0));
  const saldoAFavor = saldoFavorVisual > 0.01;
  const pagadoYBloqueado = alDia && routerEstado === 'BLOQUEADO';
  const debeYHabilitado = conDeuda && routerEstado === 'HABILITADO';
  const sinMac = !tieneMac;
  const sinProblemaOperativo = alDia && !pagadoYBloqueado && !debeYHabilitado && !sinMac;

  return {
    persona,
    cargo,
    cuenta,
    pagosDelMes,
    tieneMac,
    routerEstado,
    conDeuda,
    alDia,
    pagoParcial,
    saldoAFavor,
    saldoFavorVisual,
    pagadoYBloqueado,
    debeYHabilitado,
    sinMac,
    sinProblemaOperativo
  };
}

function cuentaOperativaDesdeCargo(cargo) {
  return cuentaOperativaDesdeCuenta(cargo.persona, cargo.mes, cargo, estadoCuentaCargo(cargo));
}

async function cuentasOperativasDelMes(mes) {
  const calculo = await obtenerCalculoMensualEstado(mes);
  return (calculo.cargos || []).map(cuentaOperativaDesdeCargo);
}

function panelMetricCard(label, value, detail, tone, section = '') {
  const nav = section
    ? `<button type="button" data-panel-nav="${escapeHtml(section)}">Ir</button>`
    : '';
  return `
    <article class="panel-metric panel-tone-${escapeHtml(tone || 'neutral')}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail || '')}</small>
      ${nav}
    </article>
  `;
}

function renderAccionesUrgentes(comprobantesPendientes, cuentas) {
  const acciones = [
    ...comprobantesPendientes.map((comprobante) => ({
      prioridad: 1,
      tipo: 'Comprobante pendiente',
      persona: state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id))?.nombre || 'Sin persona',
      detalle: `${comprobante.mes_aplicado || ''} - ${comprobante.monto_informado == null ? 'Sin monto' : formatARS(comprobante.monto_informado)}`,
      destino: 'comprobantes'
    })),
    ...cuentas.filter((item) => item.debeYHabilitado).map((item) => ({
      prioridad: 2,
      tipo: 'Debe y esta habilitado',
      persona: item.persona.nombre,
      detalle: `Pendiente ${formatARS(item.cuenta.pendiente)}. Accion sugerida: bloquear MAC.`,
      destino: 'router'
    })),
    ...cuentas.filter((item) => item.pagadoYBloqueado).map((item) => ({
      prioridad: 3,
      tipo: 'Pago y esta bloqueado',
      persona: item.persona.nombre,
      detalle: 'Accion sugerida: habilitar MAC.',
      destino: 'router'
    })),
    ...cuentas.filter((item) => item.conDeuda && !item.debeYHabilitado).map((item) => ({
      prioridad: 4,
      tipo: 'Persona con deuda',
      persona: item.persona.nombre,
      detalle: `Pendiente ${formatARS(item.cuenta.pendiente)}.`,
      destino: 'pagos'
    })),
    ...cuentas.filter((item) => item.sinMac).map((item) => ({
      prioridad: 5,
      tipo: 'Persona sin MAC',
      persona: item.persona.nombre,
      detalle: 'Accion sugerida: pedir/cargar MAC.',
      destino: 'personas'
    }))
  ].sort((a, b) => a.prioridad - b.prioridad || a.persona.localeCompare(b.persona));

  const rows = acciones.map((accion) => `
    <tr>
      <td>${escapeHtml(accion.tipo)}</td>
      <td>${escapeHtml(accion.persona)}</td>
      <td>${escapeHtml(accion.detalle)}</td>
      <td><button type="button" data-panel-nav="${escapeHtml(accion.destino)}">Ir</button></td>
    </tr>
  `);

  return `
    <section class="panel-block">
      <h3>Acciones urgentes</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Prioridad</th><th>Persona</th><th>Detalle</th><th>Accion</th></tr></thead>
          <tbody>${rows.join('') || '<tr><td colspan="4">Sin acciones urgentes para este mes.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPendientesPago(cuentas) {
  const pendientes = cuentas
    .filter((item) => item.conDeuda)
    .sort((a, b) => b.cuenta.pendiente - a.cuenta.pendiente);
  const rows = pendientes.map((item) => `
    <tr>
      <td>${escapeHtml(item.persona.nombre)}</td>
      <td class="number">${formatARS(item.cuenta.totalDelMes)}</td>
      <td class="number">${formatARS(item.cuenta.pagado)}</td>
      <td class="number pending-due">${formatARS(item.cuenta.pendiente)}</td>
      <td><span class="status-pill status-${estadoClass(item.cuenta.estado)}">${escapeHtml(item.cuenta.estado)}</span></td>
      <td>
        <div class="table-actions">
          <button type="button" data-panel-nav="pagos">Pagos</button>
          <button type="button" data-panel-nav="mensajes">Mensajes</button>
        </div>
      </td>
    </tr>
  `);

  return `
    <section class="panel-block">
      <h3>Pendientes de pago</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Persona</th>
              <th>Total del mes</th>
              <th>Pagado</th>
              <th>Pendiente hoy</th>
              <th>Estado</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>${rows.join('') || '<tr><td colspan="6">Sin pendientes de pago.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAlertasRouter(cuentas) {
  const alertas = [
    ...cuentas.filter((item) => item.pagadoYBloqueado).map((item) => ({
      tipo: 'Pago y bloqueado',
      persona: item.persona.nombre,
      detalle: 'Accion sugerida: habilitar MAC.'
    })),
    ...cuentas.filter((item) => item.debeYHabilitado).map((item) => ({
      tipo: 'Debe y habilitado',
      persona: item.persona.nombre,
      detalle: `Pendiente ${formatARS(item.cuenta.pendiente)}. Accion sugerida: bloquear MAC.`
    })),
    ...cuentas.filter((item) => item.sinMac).map((item) => ({
      tipo: 'Falta MAC',
      persona: item.persona.nombre,
      detalle: 'Pedir/cargar MAC 1 o MAC 2.'
    }))
  ].sort((a, b) => a.persona.localeCompare(b.persona));
  const rows = alertas.map((alerta) => `
    <tr>
      <td>${escapeHtml(alerta.tipo)}</td>
      <td>${escapeHtml(alerta.persona)}</td>
      <td>${escapeHtml(alerta.detalle)}</td>
      <td><button type="button" data-panel-nav="router">Gestion router</button></td>
    </tr>
  `);

  return `
    <section class="panel-block">
      <h3>Alertas router</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Alerta</th><th>Persona</th><th>Detalle</th><th>Accion</th></tr></thead>
          <tbody>${rows.join('') || '<tr><td colspan="4">Sin alertas de router.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function renderPanelMensual() {
  const container = byId('panel-mensual-content');
  if (!container) return;

  if (isUsuario()) {
    container.innerHTML = '<p class="muted">Vista disponible para administracion y lectura.</p>';
    return;
  }

  const mes = panelMonth();
  let cuentas = [];
  try {
    cuentas = await cuentasOperativasDelMes(mes);
  } catch (error) {
    container.innerHTML = '<p class="notice" data-type="error">No se pudo calcular el panel mensual.</p>';
    setError(error);
    return;
  }
  const comprobantesPendientes = state.comprobantes.filter((comprobante) => (
    (comprobante.estado || 'PENDIENTE') === 'PENDIENTE' &&
    comprobante.mes_aplicado === mes
  ));
  const alDia = cuentas.filter((item) => item.alDia);
  const sinProblemaOperativo = cuentas.filter((item) => item.sinProblemaOperativo);
  const conDeuda = cuentas.filter((item) => item.conDeuda);
  const parciales = cuentas.filter((item) => item.pagoParcial);
  const saldoFavor = cuentas.filter((item) => item.saldoAFavor);
  const pagadoYBloqueado = cuentas.filter((item) => item.pagadoYBloqueado);
  const debeYHabilitado = cuentas.filter((item) => item.debeYHabilitado);
  const sinMac = cuentas.filter((item) => item.sinMac);
  const totalPendiente = round2(conDeuda.reduce((total, item) => total + item.cuenta.pendiente, 0));
  const totalSaldoFavor = round2(saldoFavor.reduce((total, item) => total + item.saldoFavorVisual, 0));

  container.innerHTML = `
    <div class="summary-line">
      <span>Mes operativo: <strong>${escapeHtml(mes)}</strong></span>
      <span>Personas activas: <strong>${cuentas.length}</strong></span>
    </div>
    <div class="panel-metric-grid">
      ${panelMetricCard('Comprobantes pendientes', String(comprobantesPendientes.length), 'Requieren revision ADMIN', 'warning', 'comprobantes')}
      ${panelMetricCard('Personas al dia', String(alDia.length), 'Pendiente $0 segun estado mensual', 'ok')}
      ${panelMetricCard('Personas con deuda', String(conDeuda.length), `Total pendiente ${formatARS(totalPendiente)}`, 'danger', 'pagos')}
      ${panelMetricCard('Pagos parciales', String(parciales.length), 'Tienen pago y saldo pendiente', 'warning', 'pagos')}
      ${panelMetricCard('Saldo a favor', String(saldoFavor.length), `Total ${formatARSNegativoVisual(totalSaldoFavor)}`, 'ok')}
      ${panelMetricCard('Sin problema operativo', String(sinProblemaOperativo.length), 'Al dia, con MAC y router coherente', 'ok')}
      ${panelMetricCard('Pago y bloqueado', String(pagadoYBloqueado.length), 'Accion sugerida: habilitar MAC', 'warning', 'router')}
      ${panelMetricCard('Debe y habilitado', String(debeYHabilitado.length), 'Accion sugerida: bloquear MAC', 'danger', 'router')}
      ${panelMetricCard('Personas sin MAC', String(sinMac.length), 'Accion sugerida: pedir/cargar MAC', 'neutral', 'personas')}
    </div>
    ${renderAccionesUrgentes(comprobantesPendientes, cuentas)}
    ${renderPendientesPago(cuentas)}
    ${renderAlertasRouter(cuentas)}
  `;
}

function cierreCheckItem({ titulo, estado, texto, detalle, destino }) {
  const nav = destino
    ? `<button type="button" data-cierre-nav="${escapeHtml(destino)}">Ir</button>`
    : '';
  return `
    <article class="cierre-check cierre-${escapeHtml(estado)}">
      <div>
        <span>${escapeHtml(titulo)}</span>
        <strong>${escapeHtml(detalle || '')}</strong>
        <p>${escapeHtml(texto || '')}</p>
      </div>
      ${nav}
    </article>
  `;
}

function cierreDetalleTable(titulo, headers, rows, emptyText) {
  if (!rows.length) return '';
  return `
    <section class="panel-block">
      <h3>${escapeHtml(titulo)}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('') || `<tr><td colspan="${headers.length}">${escapeHtml(emptyText || 'Sin datos.')}</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function renderCierreMensual() {
  const container = byId('cierre-mensual-content');
  if (!container) return;

  if (isUsuario()) {
    container.innerHTML = '<p class="muted">Vista disponible para administracion y lectura.</p>';
    return;
  }

  const mes = cierreMonth();
  let cuentas = [];
  try {
    cuentas = await cuentasOperativasDelMes(mes);
  } catch (error) {
    container.innerHTML = '<p class="notice" data-type="error">No se pudo calcular el checklist mensual.</p>';
    setError(error);
    return;
  }
  const comprobantesMes = state.comprobantes.filter((comprobante) => comprobante.mes_aplicado === mes);
  const comprobantesPendientes = comprobantesMes.filter((comprobante) => (comprobante.estado || 'PENDIENTE') === 'PENDIENTE');
  const comprobantesDescartados = comprobantesMes.filter((comprobante) => comprobante.estado === 'DESCARTADO');
  const conDeuda = cuentas.filter((item) => item.conDeuda);
  const parciales = cuentas.filter((item) => item.pagoParcial);
  const saldoFavor = cuentas.filter((item) => item.saldoAFavor);
  const debeYHabilitado = cuentas.filter((item) => item.debeYHabilitado);
  const pagadoYBloqueado = cuentas.filter((item) => item.pagadoYBloqueado);
  const sinMac = cuentas.filter((item) => item.sinMac);
  const totalPendiente = round2(conDeuda.reduce((total, item) => total + item.cuenta.pendiente, 0));
  const totalSaldoFavor = round2(saldoFavor.reduce((total, item) => total + item.saldoFavorVisual, 0));
  const requiereRevision = (
    comprobantesPendientes.length > 0 ||
    conDeuda.length > 0 ||
    parciales.length > 0 ||
    debeYHabilitado.length > 0 ||
    pagadoYBloqueado.length > 0
  );
  const estadoGeneral = requiereRevision ? 'Requiere revision' : 'Listo para cierre operativo';
  const estadoClassName = requiereRevision ? 'warning' : 'ok';

  const checks = [
    cierreCheckItem({
      titulo: 'Backup mensual',
      estado: 'info',
      detalle: 'Recordatorio',
      texto: 'Descargar backup mensual desde Exportacion antes de dar por cerrado el mes.',
      destino: 'exportacion'
    }),
    cierreCheckItem({
      titulo: 'Comprobantes pendientes',
      estado: comprobantesPendientes.length ? 'warning' : 'ok',
      detalle: `${comprobantesPendientes.length} pendiente(s)`,
      texto: comprobantesPendientes.length ? 'Revisar Comprobantes.' : 'Sin comprobantes pendientes del mes.',
      destino: comprobantesPendientes.length ? 'comprobantes' : ''
    }),
    cierreCheckItem({
      titulo: 'Pagos pendientes',
      estado: conDeuda.length ? 'warning' : 'ok',
      detalle: `${conDeuda.length} persona(s) - ${formatARS(totalPendiente)}`,
      texto: conDeuda.length ? 'Revisar mensajes de cobro o pagos.' : 'Sin personas activas con pendiente hoy.',
      destino: conDeuda.length ? 'pagos' : ''
    }),
    cierreCheckItem({
      titulo: 'Pagos parciales',
      estado: parciales.length ? 'warning' : 'ok',
      detalle: `${parciales.length} persona(s)`,
      texto: parciales.length ? 'Hay pagos registrados con saldo pendiente.' : 'Sin pagos parciales pendientes.',
      destino: parciales.length ? 'pagos' : ''
    }),
    cierreCheckItem({
      titulo: 'Saldo a favor',
      estado: 'info',
      detalle: `${saldoFavor.length} persona(s) - ${formatARSNegativoVisual(totalSaldoFavor)}`,
      texto: 'Informativo. No bloquea el cierre operativo.'
    }),
    cierreCheckItem({
      titulo: 'Router: debe y esta habilitado',
      estado: debeYHabilitado.length ? 'critical' : 'ok',
      detalle: `${debeYHabilitado.length} persona(s)`,
      texto: debeYHabilitado.length ? 'Bloquear MAC en router o revisar pago.' : 'Sin personas deudoras habilitadas.',
      destino: debeYHabilitado.length ? 'router' : ''
    }),
    cierreCheckItem({
      titulo: 'Router: pago y esta bloqueado',
      estado: pagadoYBloqueado.length ? 'warning' : 'ok',
      detalle: `${pagadoYBloqueado.length} persona(s)`,
      texto: pagadoYBloqueado.length ? 'Habilitar MAC en router.' : 'Sin personas al dia bloqueadas.',
      destino: pagadoYBloqueado.length ? 'router' : ''
    }),
    cierreCheckItem({
      titulo: 'Personas sin MAC',
      estado: sinMac.length ? 'soft' : 'ok',
      detalle: `${sinMac.length} persona(s)`,
      texto: sinMac.length ? 'Informativo / advertencia suave. Pedir o cargar MAC.' : 'Todas las personas activas tienen MAC cargada.',
      destino: sinMac.length ? 'personas' : ''
    }),
    cierreCheckItem({
      titulo: 'Comprobantes descartados',
      estado: 'info',
      detalle: `${comprobantesDescartados.length} descartado(s)`,
      texto: 'Informativo. No bloquea el cierre operativo.',
      destino: comprobantesDescartados.length ? 'comprobantes' : ''
    }),
    cierreCheckItem({
      titulo: 'Mensajes de cobro',
      estado: 'info',
      detalle: 'Recordatorio',
      texto: 'Verificar manualmente que los mensajes necesarios hayan sido enviados.',
      destino: 'mensajes'
    })
  ];

  const pendientesRows = comprobantesPendientes.map((comprobante) => {
    const persona = state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id));
    return `
      <tr>
        <td>${escapeHtml(persona?.nombre || 'Sin persona')}</td>
        <td>${escapeHtml(comprobante.mes_aplicado || '')}</td>
        <td class="number">${comprobante.monto_informado == null ? '-' : formatARS(comprobante.monto_informado)}</td>
        <td>${escapeHtml(new Date(comprobante.created_at).toLocaleString('es-AR'))}</td>
        <td><button type="button" data-cierre-nav="comprobantes">Comprobantes</button></td>
      </tr>
    `;
  });
  const deudaRows = conDeuda.map((item) => `
    <tr>
      <td>${escapeHtml(item.persona.nombre)}</td>
      <td class="number">${formatARS(item.cuenta.totalDelMes)}</td>
      <td class="number">${formatARS(item.cuenta.pagado)}</td>
      <td class="number pending-due">${formatARS(item.cuenta.pendiente)}</td>
      <td><span class="status-pill status-${estadoClass(item.cuenta.estado)}">${escapeHtml(item.cuenta.estado)}</span></td>
    </tr>
  `);
  const parcialesRows = parciales.map((item) => `
    <tr>
      <td>${escapeHtml(item.persona.nombre)}</td>
      <td class="number">${formatARS(item.cuenta.pagado)}</td>
      <td class="number pending-due">${formatARS(item.cuenta.pendiente)}</td>
    </tr>
  `);
  const routerRows = [
    ...debeYHabilitado.map((item) => ({
      persona: item.persona.nombre,
      estadoCuenta: item.cuenta.estado,
      routerEstado: item.routerEstado,
      accion: 'Bloquear MAC en router o revisar pago.'
    })),
    ...pagadoYBloqueado.map((item) => ({
      persona: item.persona.nombre,
      estadoCuenta: item.cuenta.estado,
      routerEstado: item.routerEstado,
      accion: 'Habilitar MAC en router.'
    }))
  ].map((item) => `
    <tr>
      <td>${escapeHtml(item.persona)}</td>
      <td>${escapeHtml(item.estadoCuenta)}</td>
      <td>${escapeHtml(item.routerEstado)}</td>
      <td>${escapeHtml(item.accion)}</td>
    </tr>
  `);

  container.innerHTML = `
    <article class="cierre-status cierre-status-${estadoClassName}">
      <span>Estado de cierre del mes ${escapeHtml(formatMesCuenta(mes))}</span>
      <strong>${escapeHtml(estadoGeneral)}</strong>
      <p>Checklist operativo de solo lectura. No cierra ni bloquea el mes.</p>
      <button type="button" class="primary" data-cierre-paquete>Generar paquete de cierre</button>
    </article>
    <div class="cierre-checklist">${checks.join('')}</div>
    ${cierreDetalleTable('Detalle de comprobantes pendientes', ['Persona', 'Mes', 'Monto informado', 'Fecha de carga', 'Accion'], pendientesRows)}
    ${cierreDetalleTable('Detalle de personas con deuda', ['Persona', 'Total del mes', 'Pagado', 'Pendiente hoy', 'Estado'], deudaRows)}
    ${cierreDetalleTable('Detalle de pagos parciales', ['Persona', 'Pagado', 'Pendiente hoy'], parcialesRows)}
    ${cierreDetalleTable('Detalle de alertas router', ['Persona', 'Estado cuenta', 'Router', 'Accion sugerida'], routerRows)}
  `;
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
  const estaRegistrando = state.comprobantesPagoEnProceso.has(comprobante.id);
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
          <button type="submit" class="primary" ${estaRegistrando ? 'disabled' : ''}>${estaRegistrando ? 'Registrando...' : 'Confirmar y registrar pago'}</button>
          <button type="button" data-comprobante-process-cancel>Cancelar</button>
        </div>
      </form>
    </article>
  `;
}

async function renderMiCuenta() {
  const container = byId('mi-cuenta-content');
  if (!container) return;

  if (!isUsuario()) {
    container.innerHTML = '<p class="muted">Vista disponible para usuarios vinculados a una persona.</p>';
    return;
  }

  const mes = normalizarMesClave(byId('mi-cuenta-mes').value || currentMonth());
  let cargo = null;
  try {
    const calculoRpc = await obtenerCalculoMensualEstado(mes, true);
    cargo = calculoRpc.cargos?.[0] || null;
  } catch (error) {
    container.innerHTML = '<p class="notice" data-type="error">No se pudo calcular el estado mensual de tu cuenta para este mes. Avisale al administrador.</p>';
    setError(error);
    return;
  }
  const persona = cargo?.persona || state.personas.find((item) => mismaPersona(item.id, state.profile?.persona_id));

  if (!cargo || !persona) {
    container.innerHTML = `
      <p class="notice" data-type="error">No se pudo calcular el estado mensual de tu cuenta para este mes. Avisale al administrador.</p>
      <p class="muted">Mes consultado: ${escapeHtml(formatMesCuenta(mes))}. No se muestran importes globales como fallback.</p>
    `;
    return;
  }

  const pagos = state.pagos
    .filter((pago) => mismaPersona(pago.persona_id, persona.id))
    .sort((a, b) => `${b.fecha_pago}${b.created_at || ''}`.localeCompare(`${a.fecha_pago}${a.created_at || ''}`));
  const pagosRows = pagos.map((pago) => `
    <tr>
      <td>${escapeHtml(pago.fecha_pago || '')}</td>
      <td>${escapeHtml(pago.mes_aplicado || '')}</td>
      <td><span class="badge">${escapeHtml(pago.concepto || '')}</span></td>
      <td class="number">${formatARS(pago.monto || 0)}</td>
      <td>${escapeHtml(pago.observaciones || '')}</td>
    </tr>
  `);
  const mesCuenta = formatMesCuenta(mes);

  const cuenta = estadoCuentaCargo(cargo);
  const cuentaResumen = cuenta;
  const observacionCuenta = observacionEstadoCuenta(cargo, cuenta);
  const estadoResumen = cuentaResumen.estado.toUpperCase();
  const statusClass = cuentaStatusClass(cuentaResumen.estado);

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
      <article class="metric"><span>Equipo a pagar</span><strong>${formatARS(cuenta.equipoDelMes)}</strong></article>
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

function normalizarMesClave(mes) {
  return String(mes || '').replace('/', '-');
}

function mesValido(mes) {
  return MES_CIERRE_PATTERN.test(String(mes || ''));
}

function sumarMes(mes, delta) {
  const [year, month] = String(mes || '').split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function mesesCuentaHasta(mesFin) {
  const fin = normalizarMesClave(mesFin);
  const meses = [
    fin,
    ...state.pagos.map((pago) => pago.mes_aplicado),
    ...state.cargos.map((cargo) => cargo.mes),
    ...state.cierres.map((cierre) => cierre.mes)
  ]
    .map(normalizarMesClave)
    .filter((mes) => mesValido(mes) && mes <= fin)
    .sort();

  const inicio = meses[0] || fin;
  const resultado = [];
  for (let mes = inicio; mes <= fin; mes = sumarMes(mes, 1)) {
    resultado.push(mes);
  }
  return resultado;
}

function obtenerPersonaIdFilaCalculo(fila) {
  return fila?.persona_id || fila?.personaId || fila?.persona?.id || fila?.id_persona || null;
}

function estadoRpcToUi(estado) {
  const value = String(estado || '').toUpperCase();
  if (value === 'AL DIA') return 'Al dia';
  if (value === 'SALDO A FAVOR') return 'Saldo a favor';
  if (value === 'SIN CARGO') return 'Sin cargo';
  if (value === 'PARCIAL') return 'Parcial';
  if (value === 'PENDIENTE') return 'Pendiente';
  return estado || 'Sin cargo';
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

function filaRpcACargo(row) {
  const personaLocal = state.personas.find((persona) => mismaPersona(persona.id, row.persona_id));
  const persona = {
    ...(personaLocal || {}),
    id: row.persona_id,
    nombre: row.nombre || personaLocal?.nombre || '',
    dependencia: row.dependencia ?? personaLocal?.dependencia ?? '',
    router_estado: row.router_estado || personaLocal?.router_estado || '',
    mac_1: row.mac_1 ?? personaLocal?.mac_1 ?? '',
    mac_2: row.mac_2 ?? personaLocal?.mac_2 ?? ''
  };
  const equipoDelMes = round2(Number(row.equipo_mes || 0));
  const abonoDelMes = round2(Number(row.abono_mes || 0));
  const totalDelMes = round2(Number(row.total_mes || 0));
  const pagado = round2(Number(row.pagado || 0));
  const totalAjuste = round2(Number(row.ajuste_saldo_favor || 0));
  const pendiente = round2(Number(row.pendiente_hoy || 0));
  const estado = estadoRpcToUi(row.estado);
  const conceptoEquipo = equipoDelMes > 0
    ? personaLocal?.es_fundador ? 'COMPRA_INICIAL' : 'REGULARIZACION'
    : null;

  return {
    persona_id: row.persona_id,
    persona,
    mes: row.mes,
    abono_base: abonoDelMes,
    cargo_equipo: equipoDelMes,
    concepto_equipo: conceptoEquipo,
    monto_a_pagar: totalDelMes,
    concepto: row.observacion || '',
    saldo_equipo_antes: equipoDelMes,
    saldo_equipo_despues: 0,
    compensacion_aplicada: 0,
    __rpc: true,
    __observacion: row.observacion || '',
    __cuenta: {
      pagadoEquipoMes: 0,
      pagadoAbonoMes: 0,
      equipoDelMes,
      abonoDelMes,
      totalDelMes,
      pagado,
      totalAjuste,
      pendiente,
      saldoAFavor: totalAjuste > 0.01 ? totalAjuste : 0,
      estado
    }
  };
}

function calculoDesdeRpcRows(rows, mes) {
  const cargos = (rows || []).map(filaRpcACargo);
  const totalAbonoBase = round2(cargos.reduce((total, cargo) => total + Number(cargo.abono_base || 0), 0));
  const totalCargoEquipo = round2(cargos.reduce((total, cargo) => total + Number(cargo.cargo_equipo || 0), 0));
  const sumaCargos = round2(cargos.reduce((total, cargo) => total + Number(cargo.monto_a_pagar || 0), 0));
  const totalEquipo = state.config ? totalEquipoActualizado(state.config) : totalCargoEquipo;
  const totalAbono = state.config ? totalAbonoActualizado(state.config) : totalAbonoBase;

  return {
    mes,
    cerrado: Boolean(cierrePorMes(mes, 'CERRADO')),
    desde_rpc: true,
    total_equipo_actualizado: totalEquipo,
    total_abono_actualizado: totalAbono,
    usuarios_activos: cargos.length,
    total_abono_base: totalAbonoBase,
    total_cargo_equipo: totalCargoEquipo,
    total_compensacion_aplicada: 0,
    total_modelo: sumaCargos,
    suma_cargos: sumaCargos,
    diferencia_redondeo: 0,
    cargos
  };
}

function clonarCalculo(calculo) {
  return {
    ...calculo,
    cargos: (calculo.cargos || []).map((cargo) => ({
      ...cargo,
      persona: cargo.persona ? { ...cargo.persona } : cargo.persona,
      __cuenta: cargo.__cuenta ? { ...cargo.__cuenta } : cargo.__cuenta
    }))
  };
}

function estadoCuentaCorriente({ totalDelMes, pagado, saldoAnterior, saldoFinal }) {
  const disponibleInicial = round2(Math.max(Number(saldoAnterior || 0), 0) + Number(pagado || 0));
  const pendiente = saldoFinal < -0.01 ? round2(Math.abs(saldoFinal)) : 0;
  const saldoAFavor = saldoFinal > 0.01 ? round2(saldoFinal) : 0;

  if (Number(totalDelMes || 0) <= 0.01 && Number(pagado || 0) <= 0.01 && Math.abs(Number(saldoAnterior || 0)) <= 0.01) {
    return { estado: 'Sin cargo', pendiente: 0, saldoAFavor: 0 };
  }
  if (saldoAFavor > 0.01) {
    return { estado: 'Saldo a favor', pendiente: 0, saldoAFavor };
  }
  if (pendiente <= 0.01) {
    return { estado: 'Al dia', pendiente: 0, saldoAFavor: 0 };
  }
  if (disponibleInicial <= 0.01) {
    return { estado: 'Pendiente', pendiente, saldoAFavor: 0 };
  }
  return { estado: 'Parcial', pendiente, saldoAFavor: 0 };
}

function aplicarCuentaCorrienteAlCargo(cargo, saldoAnterior) {
  const cuentaBase = estadoCuentaCargo(cargo);
  const totalDelMes = round2(Number(cuentaBase.totalDelMes || 0));
  const pagado = round2(Number(cuentaBase.pagado || 0));
  const saldoFinal = round2(Number(saldoAnterior || 0) + pagado - totalDelMes);
  const estado = estadoCuentaCorriente({ totalDelMes, pagado, saldoAnterior, saldoFinal });

  cargo.__saldo_anterior = round2(Number(saldoAnterior || 0));
  cargo.__saldo_final = saldoFinal;
  cargo.__cuenta = {
    ...cuentaBase,
    totalDelMes,
    pagado,
    totalAjuste: estado.saldoAFavor,
    pendiente: estado.pendiente,
    saldoAFavor: estado.saldoAFavor,
    estado: estado.estado
  };

  if (estado.saldoAFavor > 0.01) {
    cargo.__observacion = 'Saldo a favor disponible.';
  } else if (estado.pendiente <= 0.01 && totalDelMes > 0.01) {
    cargo.__observacion = Number(saldoAnterior || 0) > 0.01
      ? 'Saldo a favor aplicado.'
      : 'Cuota mensual registrada.';
  } else if (estado.estado === 'Parcial') {
    cargo.__observacion = 'Pago parcial registrado.';
  } else if (estado.estado === 'Pendiente') {
    cargo.__observacion = 'Cuota mensual pendiente.';
  }

  return saldoFinal;
}

async function aplicarCuentaCorrienteHastaMes(calculoFinal, force = false) {
  const mesFinal = normalizarMesClave(calculoFinal.mes);
  const meses = mesesCuentaHasta(mesFinal);
  const saldosPorPersona = new Map();
  let calculoAjustado = calculoFinal;

  for (const mes of meses) {
    const calculoMes = mes === mesFinal
      ? calculoFinal
      : await obtenerCalculoMensualEstadoBase(mes, force);

    for (const cargo of calculoMes.cargos || []) {
      const personaId = String(cargo.persona_id || '');
      const saldoAnterior = saldosPorPersona.get(personaId) || 0;
      const saldoFinal = aplicarCuentaCorrienteAlCargo(cargo, saldoAnterior);
      saldosPorPersona.set(personaId, saldoFinal);
    }

    if (mes === mesFinal) {
      calculoAjustado = calculoMes;
    }
  }

  return calculoAjustado;
}

async function obtenerCalculoMensualEstadoBase(mes, force = false) {
  const mesClave = normalizarMesClave(mes || currentMonth());
  if (!force && state.calculosRpcRaw[mesClave]) return clonarCalculo(state.calculosRpcRaw[mesClave]);

  const { data, error } = await state.supabase.rpc('get_calculo_mensual_estado', { p_mes: mesClave });
  if (error) throw error;

  const calculo = calculoDesdeRpcRows(data || [], mesClave);
  state.calculosRpcRaw[mesClave] = calculo;
  return clonarCalculo(calculo);
}

async function obtenerCalculoMensualEstado(mes, force = false) {
  const mesClave = normalizarMesClave(mes || currentMonth());
  if (!force && state.calculosRpc[mesClave]) return state.calculosRpc[mesClave];

  const calculoBase = await obtenerCalculoMensualEstadoBase(mesClave, force);
  const calculo = await aplicarCuentaCorrienteHastaMes(calculoBase, force);
  state.calculosRpc[mesClave] = calculo;
  return calculo;
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

function cargoMensualPersona(personaId, mes) {
  const calculoVisible = calculoGuardadoVisible(mes)
    || (state.calculo?.mes === mes ? state.calculo : null)
    || (state.config ? calcularCargosMensuales(state.config, state.personas, state.pagos, mes) : null);

  const cargo = calculoVisible?.cargos?.find((item) => mismaPersona(item.persona_id, personaId));
  return cargo ? cargoConPersona(cargo) : null;
}

async function filaMiCuentaDesdeCalculoMensual(personaId, mes) {
  const mesClave = normalizarMesClave(mes);
  const personaIdProfile = String(personaId || '');
  const calculoRpc = await obtenerCalculoMensualEstado(mesClave);
  const cargoRpc = calculoRpc.cargos?.find((fila) => (
    String(obtenerPersonaIdFilaCalculo(fila) || '') === personaIdProfile
  ));
  return cargoRpc ? cargoConPersona(cargoRpc) : null;
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

function pagosPersonaAntesMes(personaId, mes, concepto) {
  return round2(state.pagos
    .filter((pago) => (
      mismaPersona(pago.persona_id, personaId) &&
      pago.mes_aplicado < mes &&
      pago.concepto === concepto
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
  if (estado === 'Al dia') return 'account-status-ok';
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
  if (cargo.__cuenta) return cargo.__cuenta;

  const pagadoEquipoMes = pagosPersonaMesConceptos(cargo.persona_id, cargo.mes, ['COMPRA_INICIAL', 'REGULARIZACION']);
  const pagadoAbonoMes = pagosPersonaMes(cargo.persona_id, cargo.mes, 'ABONO');
  const ajusteMes = pagosPersonaMes(cargo.persona_id, cargo.mes, 'AJUSTE');
  const ajustePrevio = pagosPersonaAntesMes(cargo.persona_id, cargo.mes, 'AJUSTE');
  const equipoDelMes = round2(Math.max(0, Number(cargo.cargo_equipo ?? cargo.regularizacion_aplicada ?? 0)));
  const abonoDelMes = round2(Math.max(0, Number(cargo.abono_base || 0)));
  const compensacionAplicada = round2(Math.max(0, Number(cargo.compensacion_aplicada || 0)));
  const totalCalculado = round2(Math.max(equipoDelMes + abonoDelMes - compensacionAplicada, 0));
  const totalDelMes = round2(Math.max(Number(cargo.monto_a_pagar ?? totalCalculado), 0));
  const pagadoSinAjuste = round2(pagadoEquipoMes + pagadoAbonoMes);
  const deudaAntesAjuste = round2(Math.max(totalDelMes - pagadoSinAjuste, 0));
  const ajusteAplicado = round2(Math.min(ajustePrevio, deudaAntesAjuste));
  const pendiente = deudaAntesAjuste - ajusteAplicado <= 0.01 ? 0 : round2(deudaAntesAjuste - ajusteAplicado);
  const pagado = round2(pagadoSinAjuste + ajusteMes);
  const totalAjuste = round2(Math.max(0, ajustePrevio + ajusteMes - ajusteAplicado));
  const saldoAFavorVisual = round2(Math.max(totalAjuste, ajusteAplicado));
  const saldoAFavor = saldoAFavorVisual > 0.01 ? saldoAFavorVisual : 0;
  const coberturaMes = round2(pagadoSinAjuste + ajusteAplicado);
  let estado = 'Sin cargo';

  if (totalDelMes <= 0.01 && pagado <= 0.01) {
    estado = 'Sin cargo';
  } else if (pendiente <= 0.01 && totalAjuste > 0.01) {
    estado = 'Saldo a favor';
  } else if (pendiente <= 0.01) {
    estado = 'Al dia';
  } else if (coberturaMes <= 0.01) {
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
    ajustePrevio,
    ajusteMes,
    ajusteAplicado,
    pendiente,
    saldoAFavor,
    estado
  };
}

function observacionEstadoCuenta(cargo, cuenta) {
  if (cargo.__observacion) return cargo.__observacion;

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
    return `${base}. Saldo a favor disponible: ${formatARSNegativoVisual(cuenta.saldoAFavor)}`;
  }
  if (cuenta.estado === 'Al dia') {
    if (Number(cuenta.ajusteAplicado || 0) > 0) {
      return `${base}. Saldo a favor aplicado`;
    }
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
      : 'Al dia';
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

function estadoCuentaSinCargo() {
  return {
    pagadoEquipoMes: 0,
    pagadoAbonoMes: 0,
    equipoDelMes: 0,
    abonoDelMes: 0,
    totalDelMes: 0,
    pagado: 0,
    totalAjuste: 0,
    pendiente: 0,
    saldoAFavor: 0,
    estado: 'Sin cargo',
    observacion: 'Sin cargo mensual para este mes.'
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
      <span>Compensacion: <strong>${formatARS(resultado.total_compensacion_aplicada || 0)}</strong></span>
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
          <th>Observacion</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${readonly || resultado.cerrado ? '' : '<button type="button" id="cerrar-mes-btn" class="primary">Cerrar mes</button>'}
  `;
}

async function renderCalculo() {
  const mes = byId('calculo-mes')?.value || state.calculo?.mes;
  const container = byId('calculo-result');
  if (!container) return;
  if (!mes) {
    container.innerHTML = '<p class="muted">Selecciona un mes para ver los cargos.</p>';
    return;
  }

  try {
    const resultado = await obtenerCalculoMensualEstado(mes);
    state.calculo = resultado;
    container.innerHTML = renderCargosTable(resultado, !isAdmin());
  } catch (error) {
    container.innerHTML = '<p class="notice" data-type="error">No se pudo calcular el estado mensual.</p>';
    setError(error);
  }
}

async function cargosParaMensajes(mes) {
  const calculo = await obtenerCalculoMensualEstado(mes, true);
  return (calculo.cargos || [])
    .map((cargo) => {
      const cuenta = estadoCuentaCargo(cargo);
      return {
        ...cargo,
        monto_a_pagar: cuenta.pendiente,
        __monto_total_mes: cuenta.totalDelMes,
        __saldo_a_favor: cuenta.saldoAFavor,
        __estado_cuenta: cuenta.estado
      };
    })
    .filter((cargo) => cargo.persona && Number(cargo.monto_a_pagar || 0) > 0.01);
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

function routerItemDesdeCuenta(item) {
  const persona = item.persona;
  const cuenta = item.cuenta;
  const pagoCompleto = cuenta.pendiente <= 0.01 && cuenta.estado !== 'Sin cargo';
  const routerEstado = item.routerEstado;
  const macs = macsPersona(persona);
  const tieneMac = macs.length > 0;

  let prioridad = 5;
  let titulo = 'Sin pago completo y bloqueado';
  let descripcion = 'Sin accion de router pendiente.';

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
    cargo: item.cargo,
    mes: item.cargo?.mes || routerMonth(),
    totalPagado: cuenta.pagado,
    montoAPagar: cuenta.totalDelMes,
    pendiente: cuenta.pendiente,
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

async function renderRouter() {
  const mes = routerMonth();
  if (!mes) {
    byId('router-list').innerHTML = '<p class="muted">Seleccione o calcule un mes para gestionar el router.</p>';
    return;
  }

  let cuentas = [];
  try {
    cuentas = await cuentasOperativasDelMes(mes);
  } catch (error) {
    byId('router-list').innerHTML = '<p class="notice" data-type="error">No se pudo calcular la gestion router.</p>';
    setError(error);
    return;
  }

  const items = cuentas
    .map(routerItemDesdeCuenta)
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
        <span>Pendiente <strong>${formatARS(item.pendiente)}</strong></span>
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
  byId('panel-mes').value = currentMonth();
  byId('cierre-mes').value = currentMonth();
  byId('mi-cuenta-mes').value = currentMonth();
  byId('calculo-mes').value = currentMonth();
  byId('mensajes-mes').value = currentMonth();
  byId('router-mes').value = currentMonth();
  byId('filtro-pago-mes').value = currentMonth();
  byId('export-mes').value = currentMonth();
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
  byId('panel-mes').addEventListener('change', renderPanelMensual);
  byId('panel-mensual-content').addEventListener('click', handlePanelMensualAction);
  byId('cierre-mes').addEventListener('change', renderCierreMensual);
  byId('cierre-mensual-content').addEventListener('click', handleCierreMensualAction);
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
  byId('export-backup-mensual').addEventListener('click', exportBackupMensual);
  byId('export-pagos-mes').addEventListener('click', exportPagosMes);
  byId('export-comprobantes-mes').addEventListener('click', exportComprobantesMes);
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
    observaciones: imputacion.observaciones
      ? asciiGeneratedText(imputacion.observaciones)
      : basePayload.observaciones
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

  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const raw = formToObject(form);
  if (state.comprobantesPagoEnProceso.has(raw.comprobante_id)) {
    return setError('Este comprobante ya se esta procesando.');
  }

  state.comprobantesPagoEnProceso.add(raw.comprobante_id);
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Registrando...';
  }

  const comprobante = state.comprobantes.find((item) => item.id === raw.comprobante_id);
  let mantenerBloqueo = false;

  try {
    if (!comprobante) throw new Error('No se encontro el comprobante.');
    if ((comprobante.estado || 'PENDIENTE') !== 'PENDIENTE') {
      throw new Error('Solo se pueden procesar comprobantes pendientes.');
    }
    if (!comprobante.persona_id || !comprobante.mes_aplicado) {
      throw new Error('El comprobante no tiene persona o mes aplicado valido.');
    }

    const monto = normalizeNumber(raw.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error('El monto a registrar no es valido.');
    }

    const persona = state.personas.find((item) => mismaPersona(item.id, comprobante.persona_id));
    const mensaje = `Registrar pago de ${formatARS(monto)} para ${persona?.nombre || 'esta persona'} en ${comprobante.mes_aplicado}?`;
    if (!confirm(mensaje)) return;

    setLoading('Registrando pago desde comprobante...');
    const { data: comprobanteActual, error: comprobanteError } = await state.supabase
      .from('comprobantes_pago')
      .select('id, persona_id, mes_aplicado, archivo_nombre, estado, pago_ids')
      .eq('id', comprobante.id)
      .single();
    if (comprobanteError) throw comprobanteError;
    if ((comprobanteActual.estado || 'PENDIENTE') !== 'PENDIENTE') {
      throw new Error('El comprobante ya no esta PENDIENTE. No se insertaron pagos.');
    }
    if (comprobantePagoIds(comprobanteActual).length > 0) {
      throw new Error('El comprobante ya tiene pagos asociados. No se insertaron pagos.');
    }

    const observaciones = raw.observaciones?.trim()
      || `Registrado desde comprobante ${comprobanteActual.archivo_nombre || comprobante.id}`;
    const pagosCreados = await registrarPagoCompletoMes({
      personaId: comprobanteActual.persona_id,
      mes: comprobanteActual.mes_aplicado,
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
      mantenerBloqueo = true;
      throw new Error(`Los pagos se crearon, pero no se pudo marcar el comprobante como PROCESADO: ${updateError.message}`);
    }

    state.comprobanteProcesandoId = null;
    state.comprobantesFiltro = 'PROCESADO';
    await loadData();
    setOk('Pago registrado y comprobante marcado como PROCESADO.');
  } catch (error) {
    setError(error);
  } finally {
    if (!mantenerBloqueo) {
      state.comprobantesPagoEnProceso.delete(raw.comprobante_id);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Confirmar y registrar pago';
      }
    }
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

function handlePanelMensualAction(event) {
  const targetSection = event.target.dataset.panelNav;
  if (!targetSection) return;

  const mes = panelMonth();
  if (targetSection === 'comprobantes') {
    state.comprobantesFiltro = 'PENDIENTE';
    setSection('comprobantes');
    renderComprobantes();
    return;
  }
  if (targetSection === 'pagos') {
    byId('filtro-pago-mes').value = mes;
    setSection('pagos');
    renderPagos();
    return;
  }
  if (targetSection === 'mensajes') {
    byId('mensajes-mes').value = mes;
    setSection('mensajes');
    renderMensajes();
    return;
  }
  if (targetSection === 'router') {
    byId('router-mes').value = mes;
    setSection('router');
    renderRouter();
    return;
  }
  if (targetSection === 'personas') {
    setSection('personas');
  }
}

function handleCierreMensualAction(event) {
  if (event.target.dataset.cierrePaquete !== undefined) {
    generarPaqueteCierre();
    return;
  }

  const targetSection = event.target.dataset.cierreNav;
  if (!targetSection) return;

  const mes = cierreMonth();
  if (targetSection === 'exportacion') {
    byId('export-mes').value = mes;
    setSection('exportacion');
    return;
  }
  if (targetSection === 'comprobantes') {
    state.comprobantesFiltro = 'PENDIENTE';
    setSection('comprobantes');
    renderComprobantes();
    return;
  }
  if (targetSection === 'pagos') {
    byId('filtro-pago-mes').value = mes;
    setSection('pagos');
    renderPagos();
    return;
  }
  if (targetSection === 'router') {
    byId('router-mes').value = mes;
    setSection('router');
    renderRouter();
    return;
  }
  if (targetSection === 'mensajes') {
    byId('mensajes-mes').value = mes;
    setSection('mensajes');
    renderMensajes();
    return;
  }
  if (targetSection === 'personas') {
    setSection('personas');
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
      observaciones: imputacion.observaciones
        ? asciiGeneratedText(imputacion.observaciones)
        : basePayload.observaciones
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

async function calcularMes() {
  try {
    const mes = byId('calculo-mes').value;
    if (!mes) throw new Error('Selecciona un mes.');
    if (!validarMesCierre(mes)) throw new Error('El mes debe tener formato YYYY-MM.');
    state.calculo = await obtenerCalculoMensualEstado(mes, true);
    byId('calculo-result').innerHTML = renderCargosTable(state.calculo, !isAdmin());
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
  if (!data) throw new Error('El mes ya esta cerrado y no puede recalcularse.');
  return data;
}

async function closeMonth(event) {
  if (event.target.id !== 'cerrar-mes-btn') return;
  if (!isAdmin()) return setError('Tu rol permite lectura, no modificacion.');
  if (!state.calculo) return setError('Primero calcula el mes.');
  if (cierrePorMes(state.calculo.mes, 'CERRADO')) {
    return setError('El mes ya esta cerrado y no puede recalcularse.');
  }
  if (Math.abs(diferenciaTotalMensual(state.calculo)) > CIERRE_MENSUAL_TOLERANCIA) {
    return setError('La suma de cargos no coincide con el total mensual.');
  }

  try {
    setLoading('Cerrando mes...');
    const cierreActual = await obtenerCierrePorMes(state.calculo.mes);
    if (cierreActual?.estado === 'CERRADO') {
      return setError('El mes ya esta cerrado y no puede recalcularse.');
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

async function generarMensajes() {
  try {
    const mes = byId('mensajes-mes').value;
    if (!mes) throw new Error('Selecciona un mes.');
    const cargosMensajes = await cargosParaMensajes(mes);
    const mensajes = [
      ...cargosMensajes.map((cargo) => ({ persona: cargo.persona, cargo })),
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

function personasCsvRows() {
  return [
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
  ];
}

function exportPersonas() {
  downloadCsv('personas.csv', personasCsvRows());
}

function exportMonth() {
  return byId('export-mes')?.value
    || byId('panel-mes')?.value
    || byId('dashboard-mes')?.value
    || currentMonth();
}

function comprobantesPersonaMes(personaId, mes) {
  return state.comprobantes.filter((comprobante) => (
    mismaPersona(comprobante.persona_id, personaId) &&
    comprobante.mes_aplicado === mes
  ));
}

function comprobantesEstadoCantidad(comprobantes, estado) {
  return comprobantes.filter((comprobante) => (comprobante.estado || 'PENDIENTE') === estado).length;
}

function backupMensualCsvRows(mes, cuentas) {
  return [
    [
      'mes',
      'persona',
      'dependencia',
      'estado_persona',
      'router_estado',
      'telefono_whatsapp',
      'mac_1',
      'mac_2',
      'total_mes',
      'pagado',
      'pendiente_hoy',
      'estado_cuenta',
      'saldo_a_favor',
      'pagos_mes',
      'comprobantes_pendientes',
      'comprobantes_procesados',
      'comprobantes_descartados'
    ],
    ...cuentas.map((item) => {
      const persona = item.persona;
      const cuenta = item.cuenta;
      const pagosMes = pagosExistentesPersonaMes(persona.id, mes);
      const comprobantes = comprobantesPersonaMes(persona.id, mes);
      return [
        mes,
        persona.nombre,
        persona.dependencia,
        persona.estado,
        persona.router_estado,
        persona.telefono_whatsapp,
        persona.mac_1 || persona.mac,
        persona.mac_2,
        cuenta.totalDelMes,
        cuenta.pagado,
        cuenta.pendiente,
        cuenta.estado,
        cuenta.saldoAFavor,
        pagosMes.length,
        comprobantesEstadoCantidad(comprobantes, 'PENDIENTE'),
        comprobantesEstadoCantidad(comprobantes, 'PROCESADO'),
        comprobantesEstadoCantidad(comprobantes, 'DESCARTADO')
      ];
    })
  ];
}

async function exportBackupMensual() {
  const mes = exportMonth();
  try {
    const cuentas = await cuentasOperativasDelMes(mes);
    downloadCsv(`backup-mensual-${mes}.csv`, backupMensualCsvRows(mes, cuentas));
  } catch (error) {
    setError(error);
  }
}

function exportPagosMes() {
  const mes = exportMonth();
  const pagosMes = state.pagos.filter((pago) => pago.mes_aplicado === mes);
  exportPagos(pagosMes, `pagos-${mes}.csv`);
}

function comprobantesMesCsvRows(mes) {
  const personasPorId = new Map(state.personas.map((persona) => [String(persona.id), persona]));
  const comprobantesMes = state.comprobantes.filter((comprobante) => comprobante.mes_aplicado === mes);
  return [
    ['fecha_carga', 'mes_aplicado', 'persona', 'monto_informado', 'estado', 'archivo_nombre', 'archivo_tipo', 'observaciones', 'revisado_at'],
    ...comprobantesMes.map((comprobante) => {
      const persona = personasPorId.get(String(comprobante.persona_id));
      return [
        comprobante.created_at,
        comprobante.mes_aplicado,
        persona?.nombre || '',
        comprobante.monto_informado,
        comprobante.estado,
        comprobante.archivo_nombre,
        comprobante.archivo_tipo,
        comprobante.observaciones,
        comprobante.revisado_at
      ];
    })
  ];
}

function exportComprobantesMes() {
  const mes = exportMonth();
  downloadCsv(`comprobantes-${mes}.csv`, comprobantesMesCsvRows(mes));
}

function pagosCsvRows(pagos) {
  const personasPorId = new Map(state.personas.map((persona) => [String(persona.id), persona]));
  const grupos = new Map();

  for (const pago of pagos || []) {
    if (pago.concepto === 'PAGO_COMPLETO_MES') continue;
    const createdAtSegundo = pago.created_at ? new Date(pago.created_at).toISOString().slice(0, 19) : '';
    const fallbackObservacion = createdAtSegundo ? '' : String(pago.observaciones || '');
    const clave = [
      pago.persona_id,
      pago.fecha_pago,
      pago.mes_aplicado,
      pago.medio || '',
      createdAtSegundo,
      fallbackObservacion
    ].join('|');
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        persona_id: pago.persona_id,
        fecha_pago: pago.fecha_pago,
        mes_aplicado: pago.mes_aplicado,
        medio: pago.medio || '',
        equipo: 0,
        abono: 0,
        ajuste: 0,
        observaciones: new Set()
      });
    }
    const grupo = grupos.get(clave);
    const monto = Number(pago.monto || 0);
    if (['COMPRA_INICIAL', 'REGULARIZACION'].includes(pago.concepto)) {
      grupo.equipo = round2(grupo.equipo + monto);
    } else if (pago.concepto === 'ABONO') {
      grupo.abono = round2(grupo.abono + monto);
    } else if (pago.concepto === 'AJUSTE') {
      grupo.ajuste = round2(grupo.ajuste + monto);
    }
    if (pago.observaciones) grupo.observaciones.add(pago.observaciones);
  }

  const filas = Array.from(grupos.values())
    .map((grupo) => {
      const persona = personasPorId.get(String(grupo.persona_id));
      const total = round2(grupo.equipo + grupo.abono + grupo.ajuste);
      return {
        nombre: persona?.nombre || '',
        fecha_pago: grupo.fecha_pago || '',
        total,
        equipo: grupo.equipo,
        abono: grupo.abono,
        ajuste: grupo.ajuste,
        mes_aplicado: grupo.mes_aplicado || '',
        medio: grupo.medio,
        observaciones: Array.from(grupo.observaciones).join(' | ')
      };
    })
    .sort((a, b) => (
      a.nombre.localeCompare(b.nombre) ||
      a.fecha_pago.localeCompare(b.fecha_pago) ||
      a.mes_aplicado.localeCompare(b.mes_aplicado)
    ));

  return [
    ['Nombre', 'Fecha de pago', 'Total pagado', 'Equipo', 'Abono', 'Ajuste', 'Mes aplicado', 'Medio', 'Observaciones'],
    ...filas.map((fila) => [
      fila.nombre,
      fila.fecha_pago,
      fila.total,
      fila.equipo,
      fila.abono,
      fila.ajuste,
      fila.mes_aplicado,
      fila.medio,
      fila.observaciones
    ])
  ];
}

function exportPagos(pagos, filename) {
  downloadCsv(filename, pagosCsvRows(pagos));
}

function estadoCuentaCsvRows(mes, cuentas) {
  return [
    ['mes', 'persona', 'dependencia', 'equipo_mes', 'abono_mes', 'total_mes', 'pagado', 'ajuste_saldo_favor', 'pendiente_hoy', 'estado', 'observacion'],
    ...cuentas.map((item) => [
      mes,
      item.persona.nombre,
      item.persona.dependencia,
      item.cuenta.equipoDelMes,
      item.cuenta.abonoDelMes,
      item.cuenta.totalDelMes,
      item.cuenta.pagado,
      item.cuenta.saldoAFavor,
      item.cuenta.pendiente,
      item.cuenta.estado,
      item.cargo ? observacionEstadoCuenta(item.cargo, item.cuenta) : item.cuenta.observacion
    ])
  ];
}

function accionRouterSugerida(item) {
  if (item.debeYHabilitado) return 'Bloquear MAC en router o revisar pago.';
  if (item.pagadoYBloqueado) return 'Habilitar MAC en router.';
  if (item.sinMac) return 'Pedir o cargar MAC.';
  return 'Sin accion sugerida.';
}

function routerMacCsvRows(mes, cuentas) {
  return [
    ['mes', 'persona', 'dependencia', 'router_estado', 'mac_1', 'mac_2', 'estado_cuenta', 'pendiente_hoy', 'accion_sugerida'],
    ...cuentas.map((item) => [
      mes,
      item.persona.nombre,
      item.persona.dependencia,
      item.routerEstado,
      item.persona.mac_1 || item.persona.mac,
      item.persona.mac_2,
      item.cuenta.estado,
      item.cuenta.pendiente,
      accionRouterSugerida(item)
    ])
  ];
}

function deudoresCsvRows(mes, cuentas) {
  return [
    ['mes', 'persona', 'dependencia', 'total_mes', 'pagado', 'pendiente_hoy', 'estado'],
    ...cuentas
      .filter((item) => item.conDeuda)
      .map((item) => [
        mes,
        item.persona.nombre,
        item.persona.dependencia,
        item.cuenta.totalDelMes,
        item.cuenta.pagado,
        item.cuenta.pendiente,
        item.cuenta.estado
      ])
  ];
}

function comprobantesPendientesCsvRows(mes) {
  const personasPorId = new Map(state.personas.map((persona) => [String(persona.id), persona]));
  const comprobantesPendientes = state.comprobantes.filter((comprobante) => (
    comprobante.mes_aplicado === mes &&
    (comprobante.estado || 'PENDIENTE') === 'PENDIENTE'
  ));
  return [
    ['fecha_carga', 'mes_aplicado', 'persona', 'monto_informado', 'estado', 'archivo_nombre', 'archivo_tipo', 'observaciones'],
    ...comprobantesPendientes.map((comprobante) => {
      const persona = personasPorId.get(String(comprobante.persona_id));
      return [
        comprobante.created_at,
        comprobante.mes_aplicado,
        persona?.nombre || '',
        comprobante.monto_informado,
        comprobante.estado || 'PENDIENTE',
        comprobante.archivo_nombre,
        comprobante.archivo_tipo,
        comprobante.observaciones
      ];
    })
  ];
}

function saldoFavorCsvRows(mes, cuentas) {
  return [
    ['mes', 'persona', 'dependencia', 'total_mes', 'pagado', 'ajuste_saldo_favor', 'pendiente_hoy', 'estado'],
    ...cuentas
      .filter((item) => item.saldoAFavor)
      .map((item) => [
        mes,
        item.persona.nombre,
        item.persona.dependencia,
        item.cuenta.totalDelMes,
        item.cuenta.pagado,
        item.saldoFavorVisual,
        item.cuenta.pendiente,
        item.cuenta.estado
      ])
  ];
}

async function generarPaqueteCierre() {
  if (isUsuario()) return setError('Tu rol no permite generar paquete de cierre.');
  const JSZipCtor = window.JSZip;
  if (!JSZipCtor) {
    setError('No se pudo generar el ZIP. Verificar que la libreria local JSZip este cargada.');
    return;
  }

  try {
    const mes = cierreMonth();
    const cuentas = await cuentasOperativasDelMes(mes);
    const pagosMes = state.pagos.filter((pago) => pago.mes_aplicado === mes);
    const zip = new JSZipCtor();
    const files = [
      [`01_backup_mensual_${mes}.csv`, backupMensualCsvRows(mes, cuentas)],
      [`02_pagos_mes_${mes}.csv`, pagosCsvRows(pagosMes)],
      [`03_comprobantes_mes_${mes}.csv`, comprobantesMesCsvRows(mes)],
      [`04_estado_cuenta_${mes}.csv`, estadoCuentaCsvRows(mes, cuentas)],
      [`05_router_mac_${mes}.csv`, routerMacCsvRows(mes, cuentas)],
      [`06_deudores_${mes}.csv`, deudoresCsvRows(mes, cuentas)],
      [`07_comprobantes_pendientes_${mes}.csv`, comprobantesPendientesCsvRows(mes)],
      [`08_saldo_a_favor_${mes}.csv`, saldoFavorCsvRows(mes, cuentas)],
      ['99_personas.csv', personasCsvRows()]
    ];

    for (const [filename, rows] of files) {
      zip.file(filename, rowsToCsv(rows));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(`cierre_starlink_${mes}.zip`, blob);
    setOk('Paquete de cierre generado. Guardar este archivo como respaldo operativo del mes.');
  } catch (error) {
    setError(error);
  }
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
