import { escapeHtml, optionList, ESTADOS } from './utils.js';

export function personaOptions(personas, selected = '') {
  const options = (personas || [])
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((persona) => `<option value="${escapeHtml(persona.id)}" ${persona.id === selected ? 'selected' : ''}>${escapeHtml(persona.nombre)}</option>`);
  return `<option value="">Seleccionar persona</option>${options.join('')}`;
}

export function renderPersonasTable(personas, readonly = false) {
  const rows = (personas || [])
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((persona) => `
      <tr>
        <td>${escapeHtml(persona.nombre)}</td>
        <td>${escapeHtml(persona.dependencia || '')}</td>
        <td><span class="badge">${escapeHtml(persona.estado)}</span></td>
        <td>${persona.es_fundador ? 'Si' : 'No'}</td>
        <td>${escapeHtml(persona.telefono_whatsapp || '')}</td>
        <td>${escapeHtml(persona.mac_1 || persona.mac || '')}</td>
        <td>${escapeHtml(persona.mac_2 || '')}</td>
        ${readonly ? '' : `
          <td class="actions">
            <button type="button" data-edit-persona="${escapeHtml(persona.id)}">Editar</button>
            <button type="button" class="danger" data-delete-persona="${escapeHtml(persona.id)}">Dar de baja</button>
          </td>
        `}
      </tr>
    `);

  return `
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Dependencia</th>
          <th>Estado</th>
          <th>Fundador</th>
          <th>Telefono WhatsApp</th>
          <th>MAC 1</th>
          <th>MAC 2</th>
          ${readonly ? '' : '<th>Acciones</th>'}
        </tr>
      </thead>
      <tbody>${rows.join('') || `<tr><td colspan="${readonly ? '7' : '8'}">Sin personas cargadas.</td></tr>`}</tbody>
    </table>
  `;
}

export function estadoOptions(selected) {
  return optionList(ESTADOS, selected);
}
