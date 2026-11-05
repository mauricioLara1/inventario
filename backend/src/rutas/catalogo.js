const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin);

const esId = (x) => Number.isInteger(x) && x > 0;
const texto = (x) => typeof x === 'string' && x.trim().length > 0;
const puedeSucursal = (u, sucursalId) => u.nivel >= 100 || u.sucursales.includes(sucursalId);

// Ejecuta fn dentro de una transaccion y entrega los errores al manejador central.
// fn devuelve [estado, cuerpo]; la respuesta se envia solo despues del COMMIT.
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

// ---------- Categorias de producto ----------

router.get('/categorias', async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT id, nombre, maneja_caducidad FROM categoria_producto WHERE activo ORDER BY nombre');
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/categorias', requiereNivel(50), async (req, res, next) => {
  const { nombre, maneja_caducidad } = req.body || {};
  if (!texto(nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  if (maneja_caducidad !== undefined && typeof maneja_caducidad !== 'boolean') {
    return res.status(400).json({ error: 'maneja_caducidad debe ser true o false' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO categoria_producto (nombre, maneja_caducidad) VALUES ($1, COALESCE($2, FALSE))
       RETURNING id, nombre, maneja_caducidad`, [nombre.trim(), maneja_caducidad]);
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'crear_categoria_producto', tabla: 'categoria_producto',
      registroId: r.rows[0].id, detalle: { nombre: r.rows[0].nombre } });
    return [201, r.rows[0]];
  });
});

// ---------- Productos ----------

// Lista: ?q=texto busca por nombre, codigo o codigo de barras.
// Con ?sucursal_id=N agrega precio y stock minimo en esa sucursal (debe ser tuya, salvo owner).
router.get('/productos', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%';
    const sucursalId = req.query.sucursal_id === undefined ? null : Number(req.query.sucursal_id);
    if (sucursalId !== null) {
      if (!esId(sucursalId)) return res.status(400).json({ error: 'sucursal_id invalido' });
      if (!puedeSucursal(req.usuario, sucursalId)) {
        return res.status(403).json({ error: 'Esa sucursal no es tuya' });
      }
    }
    const r = await pool.query(
      `SELECT p.id, p.codigo, p.codigo_barras, p.nombre, p.medida, p.impuesto_porcentaje,
              p.maneja_caducidad, p.activo, p.categoria_producto_id,
              ps.precio_venta, ps.stock_minimo, ps.activo AS habilitado
         FROM producto p
         LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = $2
        WHERE (p.nombre ILIKE $1 OR p.codigo ILIKE $1 OR p.codigo_barras ILIKE $1)
        ORDER BY p.nombre LIMIT 200`, [q, sucursalId]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/productos', requiereNivel(50), async (req, res, next) => {
  const b = req.body || {};
  const pct = b.impuesto_porcentaje === undefined ? 0 : b.impuesto_porcentaje;
  if (!esId(b.categoria_producto_id) || !texto(b.codigo) || !texto(b.nombre) ||
      typeof pct !== 'number' || pct < 0 || pct > 100 ||
      (b.codigo_barras !== undefined && b.codigo_barras !== null && !texto(b.codigo_barras)) ||
      (b.medida !== undefined && !texto(b.medida)) ||
      (b.maneja_caducidad !== undefined && typeof b.maneja_caducidad !== 'boolean')) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  await enTransaccion(res, next, async (client) => {
    // maneja_caducidad: si no viene, se sugiere el de la categoria.
    const r = await client.query(
      `INSERT INTO producto (categoria_producto_id, codigo, codigo_barras, nombre, medida,
                            impuesto_porcentaje, maneja_caducidad)
       SELECT c.id, $2, $3, $4, COALESCE($5, 'unidad'), $6, COALESCE($7, c.maneja_caducidad)
         FROM categoria_producto c WHERE c.id = $1 AND c.activo
       RETURNING id, codigo, codigo_barras, nombre, medida, impuesto_porcentaje, maneja_caducidad, activo`,
      [b.categoria_producto_id, b.codigo.trim(), b.codigo_barras ? b.codigo_barras.trim() : null,
       b.nombre.trim(), b.medida ? b.medida.trim() : null, pct, b.maneja_caducidad]);
    if (!r.rows[0]) {
      const err = new Error('La categoria de producto no existe');
      err.code = 'P0001';
      throw err;
    }
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'crear_producto', tabla: 'producto',
      registroId: r.rows[0].id, detalle: { codigo: r.rows[0].codigo, nombre: r.rows[0].nombre } });
    return [201, r.rows[0]];
  });
});

// Habilita un producto en una sucursal y fija su precio / stock minimo (crea o actualiza).
router.put('/productos/:id/sucursales/:sucursalId', requiereNivel(50), async (req, res, next) => {
  const productoId = Number(req.params.id);
  const sucursalId = Number(req.params.sucursalId);
  const { precio_venta, stock_minimo, activo } = req.body || {};
  if (!esId(productoId) || !esId(sucursalId) ||
      typeof precio_venta !== 'number' || precio_venta < 0 ||
      (stock_minimo !== undefined && (typeof stock_minimo !== 'number' || stock_minimo < 0)) ||
      (activo !== undefined && typeof activo !== 'boolean')) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  if (!puedeSucursal(req.usuario, sucursalId)) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO producto_sucursal (producto_id, sucursal_id, precio_venta, stock_minimo, activo)
       VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, TRUE))
       ON CONFLICT (producto_id, sucursal_id) DO UPDATE
         SET precio_venta = EXCLUDED.precio_venta,
             stock_minimo = COALESCE($4, producto_sucursal.stock_minimo),
             activo       = COALESCE($5, producto_sucursal.activo)
       RETURNING producto_id, sucursal_id, precio_venta, stock_minimo, activo`,
      [productoId, sucursalId, precio_venta, stock_minimo, activo]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId, accion: 'fijar_producto_sucursal',
      tabla: 'producto_sucursal', registroId: productoId,
      detalle: { precio_venta, stock_minimo: stock_minimo ?? null, activo: activo ?? null } });
    return [200, r.rows[0]];
  });
});

module.exports = router;
