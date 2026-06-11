import { escapeHtml, formatARS } from './utils.js';

export function renderCargosTable(resultado, readonly = false) {
  if (!resultado || !resultado.cargos?.length) {
    return '<p class="muted">Calcula un mes para ver los cargos.</p>';
  }

  const rows = resultado.cargos.map((cargo) => `
    <tr>
      <td>${escapeHtml(cargo.persona.nombre)}</td>
      <td>${cargo.persona.es_fundador ? 'Fundador' : 'Ingresante posterior'}</td>
      <td>${escapeHtml(cargo.concepto)}</td>
      <td class="number">${formatARS(cargo.saldo_equipo_antes)}</td>
      <td class="number">${formatARS(cargo.monto_a_pagar)}</td>
      <td class="number">${formatARS(cargo.saldo_equipo_despues)}</td>
    </tr>
  `);

  return `
    <div class="summary-line">
      <span>Total abono: <strong>${formatARS(resultado.total_abono_actualizado)}</strong></span>
      <span>Suma cargos: <strong>${formatARS(resultado.suma_cargos)}</strong></span>
      <span>Diferencia: <strong>${formatARS(resultado.diferencia_redondeo)}</strong></span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Persona</th>
          <th>Tipo</th>
          <th>Concepto</th>
          <th>Saldo equipo antes</th>
          <th>Monto a pagar</th>
          <th>Saldo equipo despues</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${readonly ? '' : '<button type="button" id="cerrar-mes-btn" class="primary">Cerrar mes</button>'}
  `;
}
