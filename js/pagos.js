import { CONCEPTOS_PAGO, escapeHtml, formatARS, round2 } from './utils.js';

const CONCEPTOS_PAGO_VISIBLES = [...CONCEPTOS_PAGO, 'PAGO'];

export function mesDesdeFechaPago(fechaPago) {
  return String(fechaPago || '').slice(0, 7);
}

export function conceptoOptions(selected = '') {
  return CONCEPTOS_PAGO_VISIBLES
    .map((concepto) => {
      return `<option value="${escapeHtml(concepto)}" ${concepto === selected ? 'selected' : ''}>${escapeHtml(concepto)}</option>`;
    })
    .join('');
}

export function descomponerPagoSegunCargo(montoPagado, cargo) {
  const monto = round2(montoPagado);
  if (monto <= 0) return [];

  const montoCargo = cargo?.monto_a_pagar === undefined ? null : round2(cargo.monto_a_pagar);
  const montoImputable = montoCargo === null ? monto : round2(Math.min(monto, Math.max(0, montoCargo)));
  const excedente = montoCargo === null ? 0 : round2(monto - Math.max(0, montoCargo));

  const cargoEquipo = round2(Math.max(0, Number(
    cargo?.cargo_equipo ?? cargo?.regularizacion_aplicada ?? 0
  )));
  const conceptoEquipo = cargo?.concepto_equipo || (
    cargoEquipo > 0 && Number(cargo?.regularizacion_aplicada || 0) > 0 ? 'REGULARIZACION' : null
  );
  const partes = [];

  if (cargoEquipo <= 0 || !conceptoEquipo) {
    if (montoImputable > 0) {
      partes.push({ concepto: 'ABONO', monto: montoImputable });
    }
  } else {
    const montoEquipo = round2(Math.min(montoImputable, cargoEquipo));
    const montoAbono = round2(montoImputable - montoEquipo);

    if (montoEquipo > 0) {
      partes.push({ concepto: conceptoEquipo, monto: montoEquipo });
    }
    if (montoAbono > 0) {
      partes.push({ concepto: 'ABONO', monto: montoAbono });
    }
  }

  if (excedente > 0.01) {
    partes.push({
      concepto: 'AJUSTE',
      monto: excedente,
      observaciones: 'Ajuste automatico por pago excedente'
    });
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
          <td>${escapeHtml(mesDesdeFechaPago(pago.fecha_pago))}</td>
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
