export const ESTADOS = [
  'ACTIVO',
  'PENDIENTE',
  'NO_PARTICIPA',
  'SUSPENDIDO_MORA',
  'BAJA_DEFINITIVA'
];

export const CONCEPTOS_PAGO = [
  'COMPRA_INICIAL',
  'ABONO',
  'REGULARIZACION',
  'AJUSTE'
];

export function byId(id) {
  return document.getElementById(id);
}

export function round2(value) {
  const number = Number(value || 0);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(number));
  return Math.round((number + tolerance) * 100) / 100;
}

export function formatARS(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function showNotice(message, type = 'info') {
  const node = byId('notice');
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
  node.hidden = !message;
}

export function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function optionList(items, selected = '') {
  return items
    .map((item) => `<option value="${escapeHtml(item)}" ${item === selected ? 'selected' : ''}>${escapeHtml(item)}</option>`)
    .join('');
}

export function personaLabel(persona) {
  if (!persona) return 'Sin persona';
  const dep = persona.dependencia ? ` - ${persona.dependencia}` : '';
  return `${persona.nombre}${dep}`;
}

export function normalizeNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
