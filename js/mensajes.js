import { formatARS } from './utils.js';

const ESTADOS_SIN_COBRO_MENSUAL = new Set(['NO_PARTICIPA', 'PENDIENTE', 'BAJA_DEFINITIVA']);

function lineaAlias(aliasBancario, montoAPagar) {
  const alias = String(aliasBancario || '').trim();
  if (!alias || Number(montoAPagar || 0) <= 0) return '';
  return `\nAlias para transferencia: ${alias}`;
}

function lineaSaldoAnterior(cargo) {
  const saldoAnterior = Number(cargo?.__saldo_anterior || 0);
  if (saldoAnterior >= -0.01) return '';
  return `\nIncluye saldo pendiente anterior: ${formatARS(Math.abs(saldoAnterior))}.`;
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
  const saldoFavor = Number(cargo?.__saldo_a_favor || 0);
  const cuotaAbono = Number(cargo?.__cuota_abono_mes || cargo?.abono_base || 0);
  const saldoAnterior = lineaSaldoAnterior(cargo);
  const alias = lineaAlias(aliasBancario, montoNumero);

  if (montoNumero <= 0.01 && saldoFavor > 0.01) {
    return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
No tenes que pagar este mes.
Tu cuota mensual es ${formatARS(cuotaAbono)} y tenes saldo a favor suficiente.
Saldo a favor restante: ${formatARS(saldoFavor)}.`;
  }

  if (montoNumero <= 0.01) {
    return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
No tenes que pagar este mes.
Tu cuenta esta al dia.`;
  }

  return `Hola ${persona.nombre}. Starlink ACC Cordoba.
Mes: ${mes}
Importe a pagar: ${monto}
Concepto: regularizacion de cuenta corriente Starlink ACC Cordoba.${saldoAnterior}${alias}`;
}
