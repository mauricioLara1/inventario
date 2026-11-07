export const num = (x) => Number(x).toLocaleString('es-CO', { maximumFractionDigits: 3 });
export const pesos = (x) => (x === null || x === undefined ? '—'
  : Number(x).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));
export const fecha = (x) => (x ? new Date(x).toLocaleDateString('es-CO') : '—');
