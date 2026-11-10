const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin, (req, res, next) =>
  (req.method === 'GET' ? requierePermiso('compras.ver', 'compras.gestionar') : requierePermiso('compras.gestionar'))(req, res, next));

const { esId, texto, puedeSucursal, reglaNegocio, enTransaccion } = require('../util');
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
    const idOpc = (x) => (x === undefined ? null : Number(x));
    const proveedorId = idOpc(req.query.proveedor_id);
    const recibidaPor = idOpc(req.query.recibida_por);
    if ((proveedorId !== null && !esId(proveedorId)) || (recibidaPor !== null && !esId(recibidaPor))) {
      return res.status(400).json({ error: 'proveedor_id o recibida_por invalido' });
    }
    const fechaOpc = (x) => {
      if (x === undefined) return null;
      if (typeof x !== 'string' || Number.isNaN(Date.parse(x))) return false;
      return new Date(x).toISOString();
    };
    const desde = fechaOpc(req.query.desde);
    const hasta = fechaOpc(req.query.hasta);
    if (desde === false || hasta === false) return res.status(400).json({ error: 'fecha invalida' });
    const montoOpc = (x) => (x === undefined ? null : Number(x));
    const totalMin = montoOpc(req.query.total_min);
    const totalMax = montoOpc(req.query.total_max);
    if ([totalMin, totalMax].some((m) => m !== null && !Number.isFinite(m))) {
      return res.status(400).json({ error: 'monto invalido' });
    }
    const buscar = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
    const r = await pool.query(
      `SELECT c.id, c.numero, c.sucursal_id, c.proveedor_id, p.nombre AS proveedor,
              c.numero_factura_proveedor, c.estado, c.fecha, c.recibida_por, u.nombre AS recibida_por_nombre,
              t.subtotal, t.impuesto, t.total
         FROM compra c
         JOIN proveedor p ON p.id = c.proveedor_id
         JOIN usuario u ON u.id = c.recibida_por
         JOIN v_compra_totales t ON t.compra_id = c.id
        WHERE ($1::bigint IS NULL OR c.sucursal_id = $1)
          AND ($2::bigint[] IS NULL OR c.sucursal_id = ANY($2))
          AND ($3::text IS NULL OR c.estado = $3)
          AND ($4::bigint IS NULL OR c.proveedor_id = $4)
          AND ($5::timestamptz IS NULL OR c.fecha >= $5)
          AND ($6::timestamptz IS NULL OR c.fecha <= $6)
          AND ($7::text IS NULL OR c.numero ILIKE $7 OR c.numero_factura_proveedor ILIKE $7)
          AND ($8::numeric IS NULL OR t.total >= $8)
          AND ($9::numeric IS NULL OR t.total <= $9)
          AND ($10::bigint IS NULL OR c.recibida_por = $10)
        ORDER BY c.id DESC LIMIT 200`,
      [sucursalId, propias, estado, proveedorId, desde, hasta, buscar, totalMin, totalMax, recibidaPor]);
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

// ---------- Anular una compra recibida ----------
// La base genera los movimientos contrarios. Si parte del stock ya salio falla con INV02 (el manejador la traduce a 409).

router.post('/:id/anular', async (req, res, next) => {
  const id = Number(req.params.id);
  const motivo = (req.body || {}).motivo;
  if (!texto(motivo)) return res.status(400).json({ error: 'Falta el motivo de la anulacion' });
  await enTransaccion(res, next, async (client) => {
    const c = await compraAccesible(client, req, id);
    if (!c) return [404, { error: 'Compra no encontrada' }];
    await client.query(
      'INSERT INTO compra_anulacion (compra_id, usuario_id, motivo) VALUES ($1, $2, $3)',
      [id, req.usuario.id, motivo.trim()]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: c.sucursal_id, accion: 'anular_compra',
      tabla: 'compra', registroId: id, detalle: { numero: c.numero, motivo: motivo.trim() } });
    return [200, { id, numero: c.numero, estado: 'anulada', motivo: motivo.trim() }];
  });
});

// ---------- Borrar un borrador (con sus lineas) ----------

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const c = await compraAccesible(client, req, id);
    if (!c) return [404, { error: 'Compra no encontrada' }];
    // La base rechaza ambos borrados si la compra no esta en borrador.
    await client.query('DELETE FROM compra_detalle WHERE compra_id = $1', [id]);
    await client.query('DELETE FROM compra WHERE id = $1', [id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: c.sucursal_id, accion: 'borrar_compra_borrador',
      tabla: 'compra', registroId: id, detalle: { numero: c.numero } });
    return [200, { id, numero: c.numero, borrada: true }];
  });
});

module.exports = router;
