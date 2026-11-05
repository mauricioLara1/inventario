// Utilidades compartidas por las rutas.
const pool = require('./db');

const esId = (x) => Number.isInteger(x) && x > 0;
const texto = (x) => typeof x === 'string' && x.trim().length > 0;
const puedeSucursal = (u, sucursalId) => u.nivel >= 100 || u.sucursales.includes(sucursalId);

// Dinero: numero positivo con maximo 2 decimales.
const esMonto = (x) =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

// Error de negocio con el mismo formato que los de la base (el manejador central lo traduce a 422).
function reglaNegocio(mensaje) {
  const e = new Error(mensaje);
  e.code = 'P0001';
  return e;
}

// Ejecuta fn(client) dentro de una transaccion. fn devuelve [estado, cuerpo];
// la respuesta se envia solo despues del COMMIT.
async function enTransaccion(res, next, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [estado, cuerpo] = await fn(client);
    await client.query('COMMIT');
    res.status(estado).json(cuerpo);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
}

module.exports = { esId, texto, esMonto, puedeSucursal, reglaNegocio, enTransaccion };
