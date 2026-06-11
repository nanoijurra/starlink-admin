import { round2 } from './utils.js';

export function totalConRecargo(base, recargoPct) {
  return round2(Number(base || 0) * (1 + Number(recargoPct || 0) / 100));
}

export function totalEquipoActualizado(config) {
  return totalConRecargo(config?.compra_equipo, config?.recargo_compra_pct);
}

export function totalAbonoActualizado(config) {
  return totalConRecargo(config?.abono_mensual, config?.recargo_abono_pct);
}

export function usuariosActivos(personas) {
  return (personas || []).filter((persona) => persona.estado === 'ACTIVO');
}

export function pagosPorPersona(pagos, personaId, concepto = null) {
  return (pagos || [])
    .filter((pago) => pago.persona_id === personaId && (!concepto || pago.concepto === concepto))
    .reduce((total, pago) => total + Number(pago.monto || 0), 0);
}

  export function calcularCompraInicial(config, personas, pagos) {
  const totalEquipo = totalEquipoActualizado(config);
  const fundadoresIniciales = Number(config?.fundadores_iniciales || 0);
  const aportePorFundador = fundadoresIniciales > 0 ? round2(totalEquipo / fundadoresIniciales) : 0;
  const detalle = (personas || [])
    .filter((persona) => persona.es_fundador === true)
    .map((persona) => {
      const pagado = round2(pagosPorPersona(pagos, persona.id, 'COMPRA_INICIAL'));
      const saldoPendiente = round2(Math.max(0, aportePorFundador - pagado));
      const exceso = round2(Math.max(0, pagado - aportePorFundador));
      const estadoPago = pagado <= 0
        ? 'PENDIENTE'
        : pagado < aportePorFundador
          ? 'PARCIAL'
          : 'PAGADO';

      return {
        persona_id: persona.id,
        persona,
        aporte_requerido: aportePorFundador,
        pagado,
        saldo_pendiente: saldoPendiente,
        exceso,
        estado_pago: estadoPago
      };
    });

  return {
    total_equipo_actualizado: totalEquipo,
    fundadores_iniciales: fundadoresIniciales,
    aporte_por_fundador: aportePorFundador,
    total_pagado_compra_inicial: round2(detalle.reduce((total, item) => total + item.pagado, 0)),
    total_pendiente_compra_inicial: round2(detalle.reduce((total, item) => total + item.saldo_pendiente, 0)),
    detalle
  };
}

export function calcularAportesEquipo(config, personas, pagos) {
  const activos = usuariosActivos(personas);
  const totalEquipo = totalEquipoActualizado(config);
  const usuarios = activos.length;
  const objetivoPorPersona = usuarios > 0 ? round2(totalEquipo / usuarios) : 0;

  return activos.map((persona) => {
    const compraInicialPagada = pagosPorPersona(pagos, persona.id, 'COMPRA_INICIAL');
    const regularizacionPagada = pagosPorPersona(pagos, persona.id, 'REGULARIZACION');
    const aporteRealizado = round2(compraInicialPagada + regularizacionPagada);
    const diferencia = round2(aporteRealizado - objetivoPorPersona);

    return {
      persona,
      compraInicialPagada: round2(compraInicialPagada),
      regularizacionPagada: round2(regularizacionPagada),
      aporteRealizado,
      objetivoPorPersona,
      deudaRegularizacion: Math.max(0, round2(-diferencia)),
      saldoEquipoPendiente: Math.max(0, round2(-diferencia)),
      saldoCompensatorio: Math.max(0, diferencia)
    };
  });
}

export function calcularCargosMensuales(config, personas, pagos, mes) {
  const activos = usuariosActivos(personas);
  const totalEquipo = totalEquipoActualizado(config);
  const totalAbono = totalAbonoActualizado(config);
  const usuarios = activos.length;
  const abonoBase = usuarios > 0 ? round2(totalAbono / usuarios) : 0;
  const aporteEquipoObjetivo = usuarios > 0 ? round2(totalEquipo / usuarios) : 0;
  const aportes = calcularAportesEquipo(config, personas, pagos);

  const cargos = aportes.map((aporte) => {
    const cargoEquipo = round2(aporte.saldoEquipoPendiente);
    const conceptoEquipo = cargoEquipo > 0
      ? aporte.persona.es_fundador ? 'COMPRA_INICIAL' : 'REGULARIZACION'
      : null;
    const compensacionAplicada = round2(Math.min(aporte.saldoCompensatorio, abonoBase + cargoEquipo));
    const montoAPagar = round2(Math.max(0, abonoBase + cargoEquipo - compensacionAplicada));
    const saldoEquipoAntes = round2(cargoEquipo > 0 ? aporte.saldoEquipoPendiente : aporte.saldoCompensatorio);
    const saldoEquipoDespues = round2(cargoEquipo > 0
      ? Math.max(0, aporte.saldoEquipoPendiente - cargoEquipo)
      : Math.max(0, aporte.saldoCompensatorio - compensacionAplicada));
    const concepto = conceptoEquipo === 'COMPRA_INICIAL'
      ? 'Compra inicial del equipo + abono mensual'
      : conceptoEquipo === 'REGULARIZACION'
        ? 'Regularizacion proporcional + abono mensual'
        : compensacionAplicada > 0
          ? 'Cuota reducida por saldo compensatorio'
          : 'Cuota mensual Starlink';

    return {
      persona_id: aporte.persona.id,
      persona: aporte.persona,
      mes,
      abono_base: abonoBase,
      cargo_equipo: cargoEquipo,
      concepto_equipo: conceptoEquipo,
      monto_a_pagar: montoAPagar,
      concepto,
      saldo_equipo_antes: saldoEquipoAntes,
      saldo_equipo_despues: saldoEquipoDespues,
      aporte_equipo_objetivo: aporte.objetivoPorPersona,
      aporte_equipo_realizado: aporte.aporteRealizado,
      saldo_equipo_pendiente: aporte.saldoEquipoPendiente,
      saldo_compensatorio: aporte.saldoCompensatorio,
      regularizacion_aplicada: conceptoEquipo === 'REGULARIZACION' ? cargoEquipo : 0,
      compra_inicial_aplicada: conceptoEquipo === 'COMPRA_INICIAL' ? cargoEquipo : 0,
      compensacion_aplicada: compensacionAplicada,
      ajuste_redondeo: 0
    };
  });

  const sumaAbonoBase = round2(cargos.reduce((total, cargo) => total + cargo.abono_base, 0));
  const totalCargoEquipo = round2(cargos.reduce((total, cargo) => total + cargo.cargo_equipo, 0));
  const totalCompensacionAplicada = round2(cargos.reduce((total, cargo) => total + cargo.compensacion_aplicada, 0));
  const totalModelo = round2(sumaAbonoBase + totalCargoEquipo - totalCompensacionAplicada);
  const tieneCargoEquipo = cargos.some((cargo) => cargo.cargo_equipo > 0);
  const tieneCompensacion = cargos.some((cargo) => cargo.compensacion_aplicada > 0);
  const totalEsperado = tieneCargoEquipo && tieneCompensacion ? totalAbono : totalModelo;
  let sumaCargos = round2(cargos.reduce((total, cargo) => total + cargo.monto_a_pagar, 0));
  let ajuste = round2(totalEsperado - sumaCargos);

  if (ajuste !== 0 && Math.abs(ajuste) <= 0.10) {
    const ajusteAbs = Math.abs(ajuste);
    const cargoAjustable = ajuste < 0
      ? cargos.find((cargo) => cargo.compensacion_aplicada > 0 && cargo.monto_a_pagar > ajusteAbs)
        || cargos.find((cargo) => cargo.monto_a_pagar > ajusteAbs)
      : cargos.find((cargo) => cargo.monto_a_pagar + ajuste >= 0);

    if (cargoAjustable) {
      cargoAjustable.monto_a_pagar = round2(cargoAjustable.monto_a_pagar + ajuste);
      cargoAjustable.ajuste_redondeo = ajuste;
      cargoAjustable.concepto = `${cargoAjustable.concepto} - Ajuste de redondeo`;
      sumaCargos = round2(cargos.reduce((total, cargo) => total + cargo.monto_a_pagar, 0));
      ajuste = round2(totalEsperado - sumaCargos);
    }
  }

  return {
    mes,
    total_equipo_actualizado: totalEquipo,
    total_abono_actualizado: totalAbono,
    usuarios_activos: usuarios,
    cuota_base: abonoBase,
    abono_base: abonoBase,
    aporte_equipo_objetivo_por_persona: aporteEquipoObjetivo,
    total_abono_base: sumaAbonoBase,
    total_cargo_equipo: totalCargoEquipo,
    total_compensacion_aplicada: totalCompensacionAplicada,
    total_modelo: totalEsperado,
    total_modelo_sin_ajuste: totalModelo,
    total_esperado: totalEsperado,
    suma_cargos: sumaCargos,
    diferencia_redondeo: ajuste,
    cargos
  };
}

export function resumenDashboard(config, personas, pagos, cargos, mes) {
  const activos = usuariosActivos(personas);
  const cargosMes = (cargos || []).filter((cargo) => cargo.mes === mes);
  const pagosMes = (pagos || []).filter((pago) => pago.mes_aplicado === mes);
  const totalPagado = round2(pagosMes.reduce((total, pago) => total + Number(pago.monto || 0), 0));
  const totalCargos = round2(cargosMes.reduce((total, cargo) => total + Number(cargo.monto_a_pagar || 0), 0));
  const totalARecaudar = totalCargos || totalAbonoActualizado(config);

  return {
    activos: activos.length,
    fundadoresActivos: activos.filter((persona) => persona.es_fundador).length,
    ingresantesActivos: activos.filter((persona) => !persona.es_fundador).length,
    pendientes: (personas || []).filter((persona) => persona.estado === 'PENDIENTE').length,
    suspendidos: (personas || []).filter((persona) => persona.estado === 'SUSPENDIDO_MORA').length,
    bajas: (personas || []).filter((persona) => persona.estado === 'BAJA_DEFINITIVA').length,
    totalARecaudar,
    totalPagado,
    totalPendiente: round2(Math.max(0, totalARecaudar - totalPagado))
  };
}

export function calcularMoras(personas, cargos, pagos, mesesMoraSuspension) {
  const pagosPorClave = new Map();
  for (const pago of pagos || []) {
    const clave = `${pago.persona_id}|${pago.mes_aplicado}`;
    pagosPorClave.set(clave, round2((pagosPorClave.get(clave) || 0) + Number(pago.monto || 0)));
  }

  return (personas || [])
    .map((persona) => {
      const impagos = (cargos || []).filter((cargo) => {
        if (cargo.persona_id !== persona.id || Number(cargo.monto_a_pagar || 0) <= 0) return false;
        const pagado = pagosPorClave.get(`${persona.id}|${cargo.mes}`) || 0;
        return !cargo.pagado && pagado + 0.01 < Number(cargo.monto_a_pagar || 0);
      });
      const deuda = round2(impagos.reduce((total, cargo) => total + Number(cargo.monto_a_pagar || 0), 0));
      return {
        persona,
        mesesImpagos: impagos.length,
        deuda,
        sugerirSuspension: impagos.length >= Number(mesesMoraSuspension || 3)
      };
    })
    .filter((item) => item.mesesImpagos > 0 || item.persona.estado === 'SUSPENDIDO_MORA')
    .sort((a, b) => b.mesesImpagos - a.mesesImpagos || a.persona.nombre.localeCompare(b.persona.nombre));
}
