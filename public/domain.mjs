export const UNITS = ['unidad', 'paquete', 'kg', 'g', 'l', 'ml', 'pote', 'botella', 'lata', 'frasco', 'porción'];
export const KINDS = ['location', 'product', 'lot', 'shopping'];
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new AppError(400, message); };
function text(value, label, max = 200, required = false) {
  if (value == null || value === '') { if (required) fail(`Completá ${label}.`); return null; }
  if (typeof value !== 'string' || value.trim().length > max) fail(`${label}: texto demasiado largo o inválido.`);
  const result = value.trim();
  if (!result && required) fail(`Completá ${label}.`);
  return result || null;
}
function number(value, label, fallback = null, positive = false) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || (positive && value <= 0)) fail(`${label}: ingresá una cantidad válida.`);
  const rounded = Math.round(value * 1000) / 1000;
  if (positive && rounded <= 0) fail(`${label}: la cantidad mínima es 0,001.`);
  return rounded;
}
function date(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail('Hay una fecha inválida.');
  return value;
}
function boolean(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') fail('El indicador debe ser verdadero o falso.');
  return value;
}
export function identifier(value, optional = false) {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Identificador inválido.');
  return value;
}
function unit(value) { if (!UNITS.includes(value)) fail('Elegí una unidad válida.'); return value; }
export function validate(kind, input) {
  if (!KINDS.includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) fail('Datos inválidos.');
  const notes = text(input.notes, 'notas', 2000);
  if (kind === 'location') return { name: text(input.name, 'el nombre del lugar', 100, true), notes };
  if (kind === 'product') return {
    name: text(input.name, 'el nombre del producto', 140, true),
    category: text(input.category, 'categoría', 80), unit: unit(input.unit || 'unidad'),
    minimum: number(input.minimum, 'Stock mínimo'), notes
  };
  if (kind === 'lot') return {
    product_id: identifier(input.product_id), location_id: identifier(input.location_id, true),
    quantity: number(input.quantity, 'Cantidad', 1),
    purchase_date: date(input.purchase_date), expiry_date: date(input.expiry_date),
    opened_date: date(input.opened_date), frozen_date: date(input.frozen_date), review_date: date(input.review_date),
    price: number(input.price, 'Precio'), attention: boolean(input.attention), notes
  };
  return {
    name: text(input.name, 'el nombre', 140, true), product_id: identifier(input.product_id, true),
    quantity: number(input.quantity, 'Cantidad', 1, true), unit: unit(input.unit || 'unidad'),
    purchased: boolean(input.purchased), notes
  };
}
export function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function lotAlerts(lot, today = localToday()) {
  if (lot.quantity <= 0) return [];
  const alerts = [];
  if (lot.attention) alerts.push({ type: 'attention', label: 'Revisar estado' });
  if (lot.expiry_date) {
    const days = (Date.parse(lot.expiry_date) - Date.parse(today)) / 86400000;
    if (days < 0) alerts.push({ type: 'expired', label: 'Vencimiento pasado' });
    else if (days <= 7) alerts.push({ type: 'soon', label: days === 0 ? 'Vence hoy' : `Vence en ${days} días` });
  }
  const yearAgo = new Date(`${today}T12:00:00Z`);
  const month = yearAgo.getUTCMonth();
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  if (yearAgo.getUTCMonth() !== month) yearAgo.setUTCDate(0);
  if (lot.purchase_date && lot.purchase_date < yearAgo.toISOString().slice(0,10)) alerts.push({ type: 'old', label: 'Compra de más de un año' });
  if (lot.review_date && lot.review_date <= today) alerts.push({ type: 'review', label: 'Revisión pendiente' });
  return alerts;
}
export function stocks(products, lots) {
  return products.map(p => {
    const quantity = Math.round(lots.filter(l => l.product_id === p.id).reduce((sum,l) => sum + l.quantity, 0) * 1000) / 1000;
    return { ...p, quantity, low: p.minimum != null && quantity <= p.minimum };
  });
}
