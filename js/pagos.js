import { CONCEPTOS_PAGO, escapeHtml, formatARS, round2 } from './utils.js';

const PAGO_COMPLETO_MES = 'PAGO_COMPLETO_MES';

export function conceptoOptions(selected = '', options = {}) {
  const conceptos = options.includePagoCompleto
    ? [PAGO_COMPLETO_MES, ...CONCEPTOS_PAGO]
    : CONCEPTOS_PAGO;

  return conceptos
    .map((concepto) => {
      const label = concepto === PAGO_COMPLETO_MES ? 'Pago completo del mes' : concepto;
      return `<option value="${escapeHtml(concepto)}" ${concepto === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

export function descomponerPagoSegunCargo(montoPagado, cargo) {
  const monto = round2(montoPagado);
  if (monto <= 0) return [];

  const montoCargo = cargo?.monto_a_pagar === undefined ? null : round2(cargo.monto_a_pagar);
  if (montoCargo !== null && monto > round2(montoCargo + 0.009)) {
    throw new Error(`El pago supera el monto del cargo mensual (${formatARS(montoCargo)}). Registra un ajuste por separado.`);
  }

  const cargoEquipo = round2(Math.max(0, Number(
    cargo?.cargo_equipo ?? cargo?.regularizacion_aplicada ?? 0
  )));
  const conceptoEquipo = cargo?.concepto_equipo || (
    cargoEquipo > 0 && Number(cargo?.regularizacion_aplicada || 0) > 0 ? 'REGULARIZACION' : null
  );

  if (cargoEquipo <= 0 || !conceptoEquipo) {
    return [{ concepto: 'ABONO', monto }];
  }

  const montoEquipo = round2(Math.min(monto, cargoEquipo));
  const montoAbono = round2(monto - montoEquipo);
  const partes = [];

  if (montoEquipo > 0) {
    partes.push({ concepto: conceptoEquipo, monto: montoEquipo });
  }
  if (montoAbono > 0) {
    partes.push({ concepto: 'ABONO', monto: montoAbono });
  }

  return partes;
}

export function renderPagosTable(pagos, personas) {
  const personaPorId = new Map((personas || []).map((persona) => [persona.id, persona]));
  const rows = (pagos || [])
    .sort((a, b) => `${b.fecha_pago}${b.created_at || ''}`.localeCompare(`${a.fecha_pago}${a.created_at || ''}`))
    .map((pago) => {
      const persona = personaPorId.get(pago.persona_id);
      return `
        <tr>
          <td>${escapeHtml(pago.fecha_pago)}</td>
          <td>${escapeHtml(persona?.nombre || 'Sin persona')}</td>
          <td>${escapeHtml(pago.mes_aplicado)}</td>
          <td><span class="badge">${escapeHtml(pago.concepto)}</span></td>
          <td class="number">${formatARS(pago.monto)}</td>
          <td>${escapeHtml(pago.medio)}</td>
          <td>${escapeHtml(pago.observaciones || '')}</td>
        </tr>
      `;
    });

  return `
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Persona</th>
          <th>Mes</th>
          <th>Concepto</th>
          <th>Monto</th>
          <th>Medio</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || '<tr><td colspan="7">Sin pagos registrados.</td></tr>'}</tbody>
    </table>
  `;
}
