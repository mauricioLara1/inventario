const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

// Las pruebas SOLO corren contra inventario_test: nunca contra la base real.
const urlBase = new URL(process.env.DATABASE_URL);
urlBase.pathname = '/inventario_test';
const URL_PRUEBAS = urlBase.toString();
assert.equal(new URL(URL_PRUEBAS).pathname, '/inventario_test');

const PUERTO = 3100;
const BASE = `http://localhost:${PUERTO}`;
const CLAVE = 'ClaveDePrueba-123'; // clave de mentira: solo existe en la base de pruebas

const S = { u: [] }; // estado compartido entre pruebas (ids, tokens)
let servidor;
let pool;

async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
  return { status: r.status, body: json };
}
const login = (usuario, clave) => api('POST', '/auth/login', { usuario, clave });
const vence = () => new Date(Date.now() + 3 * 86400000).toISOString();

before(async () => {
  pool = new Pool({ connectionString: URL_PRUEBAS });
  const hash = await bcrypt.hash(CLAVE, 4);
  const roles = await pool.query('SELECT id, nombre FROM categoria_empleado');
  const idRol = (n) => Number(roles.rows.find((c) => c.nombre === n).id);
  S.rolOwner = idRol('owner');
  S.rolAdmin = idRol('admin_sucursal');
  const s = await pool.query("INSERT INTO sucursal (nombre) VALUES ('Principal') RETURNING id");
  S.suc1 = Number(s.rows[0].id);
  const u = await pool.query(
    `INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
     VALUES ('Owner Prueba', 'owner1', $1, $2) RETURNING id`, [hash, S.rolOwner]);
  S.ownerId = Number(u.rows[0].id);
  await pool.query('INSERT INTO sucursal_usuario (usuario_id, sucursal_id) VALUES ($1, $2)', [S.ownerId, S.suc1]);
  const c = await pool.query(
    `INSERT INTO cliente (nombre, tipo_documento, numero_documento, telefono)
     VALUES ('Cliente Prueba', 'CC', '1234567890', '3001112233') RETURNING id`);
  S.cliente = Number(c.rows[0].id);

  servidor = spawn(process.execPath, ['src/index.js'], {
    cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(PUERTO), DATABASE_URL: URL_PRUEBAS } });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/salud`)).ok) return; } catch (e) { /* aun no arranca */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('El servidor de pruebas no arranco');
});

after(async () => {
  if (servidor) servidor.kill();
  if (pool) await pool.end();
});

test('salud, token obligatorio y login', async () => {
  assert.equal((await api('GET', '/salud')).status, 200);
  assert.equal((await api('GET', '/auth/yo')).status, 401);
  assert.equal((await login('owner1', 'clave-incorrecta')).status, 401);
  const r = await login('owner1', CLAVE);
  assert.equal(r.status, 200);
  S.T = r.body.token;
  assert.equal((await api('GET', '/auth/yo', undefined, S.T)).body.rol, 'owner');
});

test('usuarios: crear admin y reglas de gestion', async () => {
  const c = await api('POST', '/usuarios', {
    nombre: 'Admin Uno', usuario: 'admin1', clave: CLAVE,
    categoria_empleado_id: S.rolAdmin, sucursales: [S.suc1] }, S.T);
  assert.equal(c.status, 201);
  S.adminId = c.body.id;
  S.T2 = (await login('admin1', CLAVE)).body.token;
  // un admin no gestiona al owner ni se desactiva a si mismo; el owner tampoco
  assert.equal((await api('PUT', `/usuarios/${S.ownerId}/activo`, { activo: false }, S.T2)).status, 404);
  assert.equal((await api('PUT', `/usuarios/${S.adminId}/activo`, { activo: false }, S.T2)).status, 422);
  assert.equal((await api('PUT', `/usuarios/${S.ownerId}/activo`, { activo: false }, S.T)).status, 422);
  // desactivar corta la sesion al instante; reactivar la devuelve
  assert.equal((await api('PUT', `/usuarios/${S.adminId}/activo`, { activo: false }, S.T)).status, 200);
  assert.equal((await api('GET', '/auth/yo', undefined, S.T2)).status, 401);
  assert.equal((await api('PUT', `/usuarios/${S.adminId}/activo`, { activo: true }, S.T)).status, 200);
  assert.equal((await api('GET', '/auth/yo', undefined, S.T2)).status, 200);
});

test('sucursales: solo el owner edita', async () => {
  const e = await api('PUT', `/sucursales/${S.suc1}`, { direccion: 'Calle 1' }, S.T);
  assert.equal(e.status, 200);
  assert.equal(e.body.direccion, 'Calle 1');
  assert.equal((await api('PUT', `/sucursales/${S.suc1}`, { direccion: 'x' }, S.T2)).status, 403);
  assert.equal((await api('PUT', `/sucursales/${S.suc1}`, {}, S.T)).status, 400);
});

test('catalogo de renta: crear y editar', async () => {
  const f = await api('GET', '/renta-catalogo/formatos', undefined, S.T);
  S.dia = f.body.find((x) => x.nombre === 'dia').id;
  const cat = await api('POST', '/renta-catalogo/categorias', { nombre: 'Herramientas' }, S.T);
  assert.equal(cat.status, 201);
  const p = await api('POST', '/renta-catalogo/productos', {
    categoria_renta_id: cat.body.id, codigo: 'TAL-001', nombre: 'Taladro', formato_cobro_id: S.dia,
    precio: 20000, impuesto_porcentaje: 19, deposito: 50000, reposicion: 300000 }, S.T);
  assert.equal(p.status, 201);
  S.prod = p.body.id;
  for (const codigo of ['TAL-A', 'TAL-B']) {
    const u = await api('POST', '/renta-catalogo/unidades',
      { producto_renta_id: S.prod, sucursal_id: S.suc1, codigo }, S.T);
    assert.equal(u.status, 201);
    assert.equal(u.body.estado, 'disponible');
    S.u.push(u.body.id);
  }
  assert.equal((await api('PUT', `/renta-catalogo/unidades/${S.u[0]}/estado`, { estado: 'rentada' }, S.T)).status, 400);
  const e = await api('PUT', `/renta-catalogo/productos/${S.prod}`, { precio: 25000 }, S.T);
  assert.equal(e.status, 200);
  assert.equal(e.body.precio, '25000.00');
  assert.equal((await api('PUT', `/renta-catalogo/productos/${S.prod}`, { precio: 20000 }, S.T)).status, 200);
  assert.equal((await api('PUT', `/renta-catalogo/productos/${S.prod}`, { impuesto_porcentaje: 150 }, S.T)).status, 400);
});

test('renta 1: abrir, devolver, saldar el deposito y cerrar', async () => {
  const abrir = (unidades) => api('POST', '/rentas', {
    sucursal_id: S.suc1, cliente_id: S.cliente, fecha_prevista_devolucion: vence(),
    unidades, deposito_metodo: 'efectivo' }, S.T);
  const r = await abrir([S.u[0]]);
  assert.equal(r.status, 201);
  assert.equal(r.body.deposito_cobrado, '50000.00');
  assert.equal(r.body.lineas[0].tarifa_aplicada, '20000.00');
  S.renta1 = r.body.id;
  S.linea1 = r.body.lineas[0].id;
  assert.equal((await abrir([S.u[0]])).status, 422); // la pieza ya esta rentada
  assert.equal((await api('POST', `/rentas/${S.renta1}/cerrar`, undefined, S.T)).status, 422); // pieza pendiente
  const d = await api('POST', `/rentas/${S.renta1}/devolver`, { renta_detalle_id: S.linea1, estado: 'devuelta' }, S.T);
  assert.equal(d.status, 200);
  assert.equal(d.body.estado_unidad, 'disponible');
  assert.equal(d.body.total, '23800.00');
  assert.equal(d.body.cuenta.saldo, '23800.00');
  const pago = (tipo, monto) => api('POST', `/rentas/${S.renta1}/pagos`, { tipo, metodo: 'efectivo', monto }, S.T);
  assert.equal((await pago('cobro', 99999)).status, 422); // mas que el saldo
  assert.equal((await pago('aplicacion_deposito', 23800)).status, 201);
  assert.equal((await api('POST', `/rentas/${S.renta1}/cerrar`, undefined, S.T)).status, 422); // falta devolver deposito
  assert.equal((await pago('devolucion_deposito', 26200)).status, 201);
  const c = await api('POST', `/rentas/${S.renta1}/cerrar`, undefined, S.T);
  assert.equal(c.status, 200);
  assert.equal(c.body.estado, 'cerrada');
  assert.equal(c.body.cuenta.saldo, '0.00');
});

test('renta 2: pieza danada, cargo extra y cobro de mas rechazado', async () => {
  const r = await api('POST', '/rentas', {
    sucursal_id: S.suc1, cliente_id: S.cliente, fecha_prevista_devolucion: vence(),
    unidades: [S.u[1]], deposito_metodo: 'efectivo' }, S.T);
  assert.equal(r.status, 201);
  const id = r.body.id;
  const linea = r.body.lineas[0].id;
  const d = await api('POST', `/rentas/${id}/devolver`, { renta_detalle_id: linea, estado: 'danada' }, S.T);
  assert.equal(d.status, 200);
  assert.equal(d.body.estado_unidad, 'mantenimiento');
  const conceptos = await api('GET', '/renta-catalogo/conceptos', undefined, S.T);
  const cargo = await api('POST', `/rentas/${id}/cargos`,
    { renta_detalle_id: linea, concepto_cargo_id: conceptos.body[0].id, monto: 15000 }, S.T);
  assert.equal(cargo.status, 201);
  assert.equal(cargo.body.cuenta.consumo, '38800.00');
  assert.equal((await api('POST', `/rentas/${id}/pagos`, { tipo: 'cobro', metodo: 'efectivo', monto: 99999 }, S.T)).status, 422);
});

test('informes responden y el cuadre no tiene descuadres', async () => {
  for (const ruta of ['ventas', 'margenes', 'stock-bajo', 'por-vencer']) {
    const r = await api('GET', `/informes/${ruta}`, undefined, S.T);
    assert.equal(r.status, 200, ruta);
    assert.ok(Array.isArray(r.body), ruta);
  }
  const v = await api('GET', '/rentas/vencidas', undefined, S.T);
  assert.equal(v.status, 200);
  assert.equal((await api('GET', '/informes/cuadre', undefined, S.T)).body.cuadra, true);
  assert.equal((await api('GET', '/informes/cuadre', undefined, S.T2)).status, 403); // solo owner
});

test('cambiar la clave propia', async () => {
  const cambiar = (actual, nueva) => api('POST', '/auth/cambiar-clave', { clave_actual: actual, clave_nueva: nueva }, S.T2);
  assert.equal((await cambiar('incorrecta-123', 'OtraClave-4567')).status, 403);
  assert.equal((await cambiar(CLAVE, CLAVE)).status, 400);
  assert.equal((await cambiar(CLAVE, 'OtraClave-4567')).status, 200);
  assert.equal((await login('admin1', CLAVE)).status, 401);
  assert.equal((await login('admin1', 'OtraClave-4567')).status, 200);
});

// Siempre la ultima: agota los intentos fallidos de esta IP en el servidor de pruebas.
test('freno de login: tras 10 intentos fallidos responde 429', async () => {
  let ultimo;
  for (let i = 0; i < 12; i++) ultimo = (await login('owner1', 'clave-mala')).status;
  assert.equal(ultimo, 429);
});
