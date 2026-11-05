const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

const esId = (x) => Number.isInteger(x) && x > 0;
const texto = (x) => typeof x === 'string' && x.trim().length > 0;
const puedeSucursal = (u, sucursalId) => u.nivel >= 100 || u.sucursales.includes(sucursalId);

// Error de negocio con el mismo formato que los de la base (el manejador central lo traduce a 422).
function reglaNegocio(mensaje) {
  const e = new Error(mensaje);
  e.code = 'P0001';
  return e;
}

// Ejecuta fn en una transaccion. fn devuelve [estado, cuerpo]; se responde solo despues del COMMIT.
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

// Busca la compra y verifica que sea de una sucursal del usuario. Si no, responde 404 (no revela si existe).
async function compraAccesible(db, req, id) {
  if (!esId(id)) return null;
  const r = await db.query('SELECT id, sucursal_id, estado, numero FROM compra WHERE id = $1', [id]);
  const c = r.rows[0];
  return c && puedeSucursal(req.usuario, c.sucursal_id) ? c : null;
}

// ---------- Listar / ver ----------

// ?sucursal_id=N  ?estado=borrador|recibida|anulada
router.get('/', async (req, res, next) => {
  try {
    const sucursalId = req.query.sucursal_id === undefined ? null : Number(req.query.sucursal_id);
    const estado = typeof req.query.estado === 'string' ? req.query.estado : null;
    if (sucursalId !== null && (!esId(sucursalId) || !puedeSucursal(req.usuario, sucursalId))) {
      return res.status(403).json({ error: 'Esa sucursal no es tuya' });
    }
    const propias = req.usuario.nivel >= 100 ? null : req.usuario.sucursales;
    const r = await pool.query(
      `SELECT c.id, c.numero, c.sucursal_id, c.proveedor_id, p.nombre AS proveedor,
              c.numero_factura_proveedor, c.estado, c.fecha, t.subtotal, t.impuesto, t.total
         FROM compra c
         JOIN proveedor p ON p.id = c.proveedor_id
         JOIN v_compra_totales t ON t.compra_id = c.id
        WHERE ($1::bigint IS NULL OR c.sucursal_id = $1)
          AND ($2::bigint[] IS NULL OR c.sucursal_id = ANY($2))
          AND ($3::text IS NULL OR c.estado = $3)
        ORDER BY c.id DESC LIMIT 100`, [sucursalId, propias, estado]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const c = await compraAccesible(pool, req, Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Compra no encontrada' });
    const cab = await pool.query(
      `SELECT c.id, c.numero, c.sucursal_id, c.proveedor_id, p.nombre AS proveedor,
              c.numero_factura_proveedor, c.estado, c.fecha, c.recibida_por,
              t.subtotal, t.impuesto, t.total
         FROM compra c
         JOIN proveedor p ON p.id = c.proveedor_id
         JOIN v_compra_totales t ON t.compra_id = c.id
        WHERE c.id = $1`, [c.id]);
    const lineas = await pool.query(
      `SELECT d.id, d.producto_id, pr.codigo, pr.nombre, d.cantidad, d.costo_unitario,
              d.impuesto_porcentaje, d.fecha_caducidad, d.subtotal, d.impuesto, d.total
         FROM compra_detalle d JOIN producto pr ON pr.id = d.producto_id
        WHERE d.compra_id = $1 ORDER BY d.id`, [c.id]);
    res.json({ ...cab.rows[0], lineas: lineas.rows });
  } catch (e) { next(e); }
});

// ---------- Crear borrador ----------

router.post('/', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.sucursal_id) || !esId(b.proveedor_id) ||
      (b.numero_factura_proveedor !== undefined && b.numero_factura_proveedor !== null &&
       !texto(b.numero_factura_proveedor))) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  if (!puedeSucursal(req.usuario, b.sucursal_id)) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO compra (sucursal_id, proveedor_id, numero_factura_proveedor, recibida_por)
       SELECT $1, p.id, $3, $4 FROM proveedor p WHERE p.id = $2 AND p.activo
       RETURNING id, numero, sucursal_id, proveedor_id, numero_factura_proveedor, estado, fecha`,
      [b.sucursal_id, b.proveedor_id,
       b.numero_factura_proveedor ? b.numero_factura_proveedor.trim() : null, req.usuario.id]);
    if (!r.rows[0]) throw reglaNegocio('El proveedor no existe o esta inactivo');
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: b.sucursal_id, accion: 'crear_compra',
      tabla: 'compra', registroId: r.rows[0].id, detalle: { numero: r.rows[0].numero } });
    return [201, r.rows[0]];
  });
});

// ---------- Lineas (solo en borrador; lo exige la base) ----------

router.post('/:id/lineas', async (req, res, next) => {
  const b = req.body || {};
  const fechaOk = b.fecha_caducidad === undefined || b.fecha_caducidad === null ||
                  (typeof b.fecha_caducidad === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha_caducidad));
  const pctOk = b.impuesto_porcentaje === undefined || b.impuesto_porcentaje === null ||
                (typeof b.impuesto_porcentaje === 'number' && b.impuesto_porcentaje >= 0 && b.impuesto_porcentaje <= 100);
  if (!esId(b.producto_id) || typeof b.cantidad !== 'number' || !(b.cantidad > 0) ||
      typeof b.costo_unitario !== 'number' || b.costo_unitario < 0 || !fechaOk || !pctOk) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  try {
    const c = await compraAccesible(pool, req, Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Compra no encontrada' });
    // Si no se envia impuesto_porcentaje, la base lo copia del producto.
    const r = await pool.query(
      `INSERT INTO compra_detalle (compra_id, sucursal_id, producto_id, cantidad, costo_unitario,
                                   impuesto_porcentaje, fecha_caducidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, producto_id, cantidad, costo_unitario, impuesto_porcentaje,
                 fecha_caducidad, subtotal, impuesto, total`,
      [c.id, c.sucursal_id, b.producto_id, b.cantidad, b.costo_unitario,
       b.impuesto_porcentaje ?? null, b.fecha_caducidad ?? null]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/lineas/:lineaId', async (req, res, next) => {
  try {
    const c = await compraAccesible(pool, req, Number(req.params.id));
    const lineaId = Number(req.params.lineaId);
    if (!c || !esId(lineaId)) return res.status(404).json({ error: 'Compra no encontrada' });
    const r = await pool.query('DELETE FROM compra_detalle WHERE id = $1 AND compra_id = $2', [lineaId, c.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Linea no encontrada' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- Recibir: crea los lotes y sube el stock (lo hacen los triggers) ----------

router.post('/:id/recibir', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const c = await compraAccesible(client, req, id);
    if (!c) return [404, { error: 'Compra no encontrada' }];
    // El usuario que recibe queda como "recibida_por" (es quien figura en el kardex).
    const r = await client.query(
      `UPDATE compra SET estado = 'recibida', recibida_por = $2
        WHERE id = $1 AND estado = 'borrador' RETURNING id, numero, estado`, [id, req.usuario.id]);
    if (!r.rows[0]) throw reglaNegocio(`La compra ${c.numero} no esta en borrador (esta ${c.estado})`);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: c.sucursal_id, accion: 'recibir_compra',
      tabla: 'compra', registroId: id, detalle: { numero: r.rows[0].numero } });
    const lotes = await client.query(
      `SELECT l.id AS lote_id, l.producto_id, l.cantidad_inicial, l.fecha_caducidad
         FROM lote l JOIN compra_detalle d ON d.id = l.compra_detalle_id
        WHERE d.compra_id = $1 ORDER BY l.id`, [id]);
    return [200, { ...r.rows[0], lotes: lotes.rows }];
  });
});

module.exports = router;
