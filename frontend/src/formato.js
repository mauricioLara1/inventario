import i18n from './i18n';

// Los números y fechas siguen el idioma elegido; la moneda siempre es peso colombiano.
const loc = () => (i18n.language === 'en' ? 'en-US' : 'es-CO');

export const num = (x) => Number(x).toLocaleString(loc(), { maximumFractionDigits: 3 });
export const pesos = (x) => (x === null || x === undefined ? '—'
  : Number(x).toLocaleString(loc(), { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));
export const fecha = (x) => (x ? new Date(x).toLocaleDateString(loc()) : '—');
export const fechaHora = (x) => (x ? new Date(x).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
