import { formatARS } from './utils.js';

const ESTADOS_SIN_COBRO_MENSUAL = new Set(['NO_PARTICIPA', 'PENDIENTE', 'BAJA_DEFINITIVA']);

function lineaAlias(aliasBancario, montoAPagar) {
  const alias = String(aliasBancario || '').trim();
  if (!alias || Number(montoAPagar || 0) <= 0) return '';
  return `\nAlias para transferencia: ${alias}`;
}

export function mensajePorCargo(persona, cargo, mes, aliasBancario = '') {
  if (persona.estado === 'SUSPENDIDO_MORA') {
    return `Hola ${persona.nombre}. Registras mora en el servicio Starlink ACC Cordoba. Para regularizar el acceso, comunicate con la administracion.`;
  }

  if (ESTADOS_SIN_COBRO_MENSUAL.has(persona.estado)) {
    return null;
  }

  const montoNumero = Number(cargo?.monto_a_pagar || 0);
  const monto = formatARS(montoNumero);
  const alias = lineaAlias(aliasBancario, montoNumero);

  if (cargo?.concepto_equipo === 'COMPRA_INICIAL' || cargo?.compra_inicial_aplicada > 0) {
    return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
Importe a pagar: ${monto}
Concepto: compra inicial del equipo + abono mensual.${alias}`;
  }

  if (cargo?.concepto_equipo === 'REGULARIZACION' || cargo?.regularizacion_aplicada > 0) {
    return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
Importe a pagar: ${monto}
Concepto: regularizacion proporcional de compra inicial + abono mensual.
La regularizacion se usa dentro de la cuota mensual para armonizar los aportes. Una vez equilibrado el costo inicial, pasas a cuota normal.${alias}`;
  }

  if (cargo?.compensacion_aplicada > 0) {
    return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
Importe a pagar: ${monto}
Concepto: saldo compensatorio por aporte inicial del equipo.${alias}`;
  }

  return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
Importe a pagar: ${monto}
Concepto: cuota mensual del servicio.${alias}`;
}
