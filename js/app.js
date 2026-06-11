import { createSupabaseClient, getProfile, getSession, signIn, signOut } from './auth.js';
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
  calculo: null
};

function isAdmin() {
  return state.profile?.rol === 'ADMIN';
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
}

async function loadTable(name, query = '*') {
  const { data, error } = await state.supabase.from(name).select(query);
  if (error) throw error;
  return data || [];
}

async function loadData() {
  setLoading('Cargando datos...');
  const [configs, personas, pagos, cierres, cargos] = await Promise.all([
    state.supabase.from('app_config').select('*').order('updated_at', { ascending: false }).limit(1),
    state.supabase.from('personas').select('*').order('nombre'),
    state.supabase.from('pagos').select('*').order('fecha_pago', { ascending: false }),
    state.supabase.from('cierres_mensuales').select('*').order('mes', { ascending: false }),
    state.supabase.from('cargos_mensuales').select('*').order('mes', { ascending: false })
  ]);

  for (const result of [configs, personas, pagos, cierres, cargos]) {
    if (result.error) throw result.error;
  }

  state.config = configs.data?.[0] || null;
  state.personas = personas.data || [];
  state.pagos = pagos.data || [];
  state.cierres = cierres.data || [];
  state.cargos = cargos.data || [];

  renderAll();
  showNotice('', 'info');
}

function renderAll() {
  applyAccess();
  renderConfig();
  renderDashboard();
  renderPersonas();
  renderPagos();
  renderCalculo();
  renderMensajes();
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
  byId('pago-concepto').innerHTML = conceptoOptions('ABONO');
  byId('filtro-pago-concepto').innerHTML = `<option value="" ${selectedConcepto ? '' : 'selected'}>Todos</option>${conceptoOptions(selectedConcepto)}`;
  byId('pagos-table').innerHTML = renderPagosTable(pagosFiltrados(), state.personas);
}

function renderCargosTable(resultado, readonly = false) {
  if (!resultado || !resultado.cargos?.length) {
    return '<p class="muted">Calcula un mes para ver los cargos.</p>';
  }

  const rows = resultado.cargos.map((cargo) => `
    <tr>
      <td>${escapeHtml(cargo.persona.nombre)}</td>
      <td class="number">${formatARS(cargo.abono_base || 0)}</td>
      <td class="number">${formatARS(cargo.cargo_equipo || 0)}</td>
      <td><span class="badge">${escapeHtml(cargo.concepto_equipo || '-')}</span></td>
      <td class="number">${formatARS(cargo.compensacion_aplicada || 0)}</td>
      <td class="number"><strong>${formatARS(cargo.monto_a_pagar || 0)}</strong></td>
      <td class="number">${formatARS(cargo.saldo_equipo_antes || 0)}</td>
      <td class="number">${formatARS(cargo.saldo_equipo_despues || 0)}</td>
      <td>${escapeHtml(cargo.concepto || '')}</td>
    </tr>
  `);

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
          <th>Abono base</th>
          <th>Cargo equipo</th>
          <th>Concepto equipo</th>
          <th>Compensación</th>
          <th>Total a pagar</th>
          <th>Saldo equipo antes</th>
          <th>Saldo equipo después</th>
          <th>Concepto / observación</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${readonly || resultado.cerrado ? '' : '<button type="button" id="cerrar-mes-btn" class="primary">Cerrar mes</button>'}
  `;
}

function renderCalculo() {
  byId('calculo-result').innerHTML = renderCargosTable(state.calculo, !isAdmin());
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
      <td>${escapeHtml(item.persona.mac || '')}</td>
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
  state.profile = await getProfile(state.supabase, session.user.id);
  byId('login-section').hidden = true;
  byId('app-shell').hidden = false;
  await loadData();
}

async function boot() {
  byId('dashboard-mes').value = currentMonth();
  byId('calculo-mes').value = currentMonth();
  byId('mensajes-mes').value = currentMonth();
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
  byId('filtro-pago-persona').addEventListener('change', renderPagos);
  byId('filtro-pago-mes').addEventListener('change', renderPagos);
  byId('filtro-pago-concepto').addEventListener('change', renderPagos);

  byId('config-form').addEventListener('submit', saveConfig);
  byId('persona-form').addEventListener('submit', savePersona);
  byId('persona-reset').addEventListener('click', resetPersonaForm);
  byId('personas-table').addEventListener('click', handlePersonaAction);
  byId('pago-form').addEventListener('submit', savePago);
  byId('calcular-btn').addEventListener('click', calcularMes);
  byId('calculo-result').addEventListener('click', closeMonth);
  byId('generar-mensajes').addEventListener('click', generarMensajes);
  byId('mensajes-list').addEventListener('click', copyMessage);
  byId('export-pagos-filtrados').addEventListener('click', () => exportPagos(pagosFiltrados(), 'pagos-filtrados.csv'));
  byId('export-personas').addEventListener('click', exportPersonas);
  byId('export-pagos').addEventListener('click', () => exportPagos(state.pagos, 'pagos.csv'));
  byId('export-cargos').addEventListener('click', exportCargos);
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
    mac: raw.mac?.trim() || null,
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

async function handlePersonaAction(event) {
  const editId = event.target.dataset.editPersona;
  const deleteId = event.target.dataset.deletePersona;

  if (editId) {
    const persona = state.personas.find((item) => item.id === editId);
    if (!persona) return;
    const form = byId('persona-form');
    form.elements.id.value = persona.id;
    form.elements.nombre.value = persona.nombre || '';
    form.elements.dependencia.value = persona.dependencia || '';
    form.elements.estado.value = persona.estado || 'ACTIVO';
    form.elements.fecha_ingreso.value = persona.fecha_ingreso || '';
    form.elements.mac.value = persona.mac || '';
    form.elements.es_fundador.checked = Boolean(persona.es_fundador);
    form.elements.observaciones.value = persona.observaciones || '';
    setSection('personas');
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
    const cargoAsociado = raw.concepto === 'ABONO'
      ? buscarCargoAsociado(raw.persona_id, raw.mes_aplicado)
      : null;
    const imputaciones = cargoAsociado
      ? descomponerPagoSegunCargo(montoPagado, cargoAsociado)
      : [{ concepto: raw.concepto, monto: montoPagado }];
    const payload = imputaciones.map((imputacion) => ({
      ...basePayload,
      monto: imputacion.monto,
      concepto: imputacion.concepto
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
      return `
        <article class="message-item">
          <header>
            <strong>${escapeHtml(persona.nombre)}</strong>
            <button type="button" data-copy-message="${escapeHtml(text)}">Copiar</button>
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
  const text = event.target.dataset.copyMessage;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setOk('Mensaje copiado.');
  } catch (error) {
    setError('No se pudo copiar el mensaje.');
  }
}

function exportPersonas() {
  downloadCsv('personas.csv', [
    ['id', 'nombre', 'dependencia', 'estado', 'es_fundador', 'fecha_ingreso', 'mac', 'observaciones'],
    ...state.personas.map((persona) => [
      persona.id,
      persona.nombre,
      persona.dependencia,
      persona.estado,
      persona.es_fundador,
      persona.fecha_ingreso,
      persona.mac,
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
