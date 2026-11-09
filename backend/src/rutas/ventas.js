const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, esMonto, puedeSucursal, reglaNegocio, enTransaccion } = require('../util');

const router = express.Router();
router.use(requiereLogin, requierePermiso('ventas.gestionar'));

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'otro'];

// Busca la venta y verifica que sea de una sucursal del usuario (si no, se responde 404).
async function ventaAccesible(db, req, id) {
  if (!esId(id)) return null;
  const r = await db.query('SELECT id, sucursal_id, estado, numero FROM venta WHERE id = $1', [id]);
  const v = r.rows[0];
  return v && puedeSucursal(req.usuario, v.sucursal_id) ? v : null;
}

// ---------- Listar / ver ----------

// ?sucursal_id=N  ?estado=borrador|confirmada
router.get('/', async (req, res, next) => {
  try {
    const sucursalId = req.query.sucursal_id === undefined ? null : Number(req.query.sucursal_id);
    const estado = typeof req.query.estado === 'string' ? req.query.estado : null;
    if (sucursalId !== null && (!esId(sucursalId) || !puedeSucursal(req.usuario, sucursalId))) {
      return res.status(403).json({ error: 'Esa sucursal no es tuya' });
    }
    const propias = req.usuario.nivel >= 100 ? null : req.usuario.sucursales;
    const vendedorId = req.query.vendedor_id === undefined ? null : Number(req.query.vendedor_id);
    const clienteId = req.query.cliente_id === undefined ? null : Number(req.query.cliente_id);
    if ((vendedorId !== null && !esId(vendedorId)) || (clienteId !== null && !esId(clienteId))) {
      return res.status(400).json({ error: 'vendedor_id o cliente_id invalido' });
    }
    const fechaOpc = (x) => {
      if (x === undefined) return null;
      if (typeof x !== 'string' || Number.isNaN(Date.parse(x))) return false;
      return new Date(x).toISOString();
    };
    const desde = fechaOpc(req.query.desde);
    const hasta = fechaOpc(req.query.hasta);
    const sinCliente = req.query.sin_cliente === 'true';
    if (desde === false || hasta === false) return res.status(400).json({ error: 'fecha invalida' });
    const r = await pool.query(
      `SELECT v.id, v.numero, v.sucursal_id, v.cliente_id, c.nombre AS cliente, v.estado, v.fecha,
              v.vendedor_id, u.nombre AS vendedor,
              t.subtotal, t.descuento, t.impuesto, t.total, s.saldo
         FROM venta v
         JOIN v_venta_totales t ON t.venta_id = v.id
         JOIN usuario u ON u.id = v.vendedor_id
         LEFT JOIN cliente c ON c.id = v.cliente_id
         LEFT JOIN v_venta_saldo s ON s.venta_id = v.id
        WHERE ($1::bigint IS NULL OR v.sucursal_id = $1)
          AND ($2::bigint[] IS NULL OR v.sucursal_id = ANY($2))
          AND ($3::text IS NULL OR v.estado = $3)
          AND ($4::bigint IS NULL OR v.vendedor_id = $4)
          AND ($5::bigint IS NULL OR v.cliente_id = $5)
          AND ($6::timestamptz IS NULL OR v.fecha >= $6)
          AND ($7::timestamptz IS NULL OR v.fecha <= $7)
          AND (NOT $8::boolean OR v.cliente_id IS NULL)
        ORDER BY v.id DESC LIMIT 200`, [sucursalId, propias, estado, vendedorId, clienteId, desde, hasta, sinCliente]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const v = await ventaAccesible(pool, req, Number(req.params.id));
    if (!v) return res.status(404).json({ error: 'Venta no encontrada' });
    const cab = await pool.query(
      `SELECT v.id, v.numero, v.sucursal_id, v.cliente_id, c.nombre AS cliente, v.vendedor_id,
              v.estado, v.fecha, t.subtotal, t.descuento, t.impuesto, t.total,
              s.total_acreditado, s.pagado_neto, s.saldo
         FROM venta v
         JOIN v_venta_totales t ON t.venta_id = v.id
         LEFT JOIN cliente c ON c.id = v.cliente_id
         LEFT JOIN v_venta_saldo s ON s.venta_id = v.id
        WHERE v.id = $1`, [v.id]);
    const lineas = await pool.query(
      `SELECT d.id, d.producto_id, p.codigo, p.nombre, d.cantidad, d.precio_unitario,
              d.descuento_porcentaje, d.impuesto_porcentaje, d.subtotal, d.descuento, d.impuesto, d.total
         FROM venta_detalle d JOIN producto p ON p.id = d.producto_id
        WHERE d.venta_id = $1 ORDER BY d.id`, [v.id]);
    const lotes = await pool.query(
      `SELECT vl.venta_detalle_id, m.lote_id, abs(m.cantidad_con_signo) AS cantidad
         FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id
         JOIN venta_detalle d ON d.id = vl.venta_detalle_id
        WHERE d.venta_id = $1 ORDER BY vl.venta_detalle_id, m.id`, [v.id]);
    const pagos = await pool.query(
      `SELECT id, tipo, metodo, monto, referencia, usuario_id, fecha
         FROM venta_pago WHERE venta_id = $1 ORDER BY id`, [v.id]);
    res.json({ ...cab.rows[0], lineas: lineas.rows, lotes: lotes.rows, pagos: pagos.rows });
  } catch (e) { next(e); }
});

// ---------- Crear borrador ----------

// cliente_id es opcional (sin cliente = consumidor final).
router.post('/', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.sucursal_id) || (b.cliente_id !== undefined && b.cliente_id !== null && !esId(b.cliente_id))) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  if (!puedeSucursal(req.usuario, b.sucursal_id)) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO venta (sucursal_id, cliente_id, vendedor_id) VALUES ($1, $2, $3)
       RETURNING id, numero, sucursal_id, cliente_id, vendedor_id, estado, fecha`,
      [b.sucursal_id, b.cliente_id ?? null, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: b.sucursal_id, accion: 'crear_venta',
      tabla: 'venta', registroId: r.rows[0].id, detalle: { numero: r.rows[0].numero } });
    return [201, r.rows[0]];
  });
});

// ---------- Lineas (solo en borrador; lo exige la base) ----------
// El precio y el IVA salen del catalogo. Solo se puede indicar un descuento.

router.post('/:id/lineas', async (req, res, next) => {
  const b = req.body || {};
  const desc = b.descuento_porcentaje === undefined ? 0 : b.descuento_porcentaje;
  if (!esId(b.producto_id) || typeof b.cantidad !== 'number' || !(b.cantidad > 0) ||
      typeof desc !== 'number' || desc < 0 || desc > 100) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  try {
    const v = await ventaAccesible(pool, req, Number(req.params.id));
    if (!v) return res.status(404).json({ error: 'Venta no encontrada' });
    const r = await pool.query(
      `INSERT INTO venta_detalle (venta_id, sucursal_id, producto_id, cantidad, precio_unitario,
                                  descuento_porcentaje, impuesto_porcentaje)
       VALUES ($1, $2, $3, $4, NULL, $5, NULL)
       RETURNING id, producto_id, cantidad, precio_unitario, descuento_porcentaje,
                 impuesto_porcentaje, subtotal, descuento, impuesto, total`,
      [v.id, v.sucursal_id, b.producto_id, b.cantidad, desc]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/lineas/:lineaId', async (req, res, next) => {
  try {
    const v = await ventaAccesible(pool, req, Number(req.params.id));
    const lineaId = Number(req.params.lineaId);
    if (!v || !esId(lineaId)) return res.status(404).json({ error: 'Venta no encontrada' });
    const r = await pool.query('DELETE FROM venta_detalle WHERE id = $1 AND venta_id = $2', [lineaId, v.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Linea no encontrada' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- Confirmar: asigna los lotes por FEFO. Sin stock suficiente falla con INV01 (409). ----------

router.post('/:id/confirmar', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const v = await ventaAccesible(client, req, id);
    if (!v) return [404, { error: 'Venta no encontrada' }];
    if (v.estado !== 'borrador') throw reglaNegocio(`La venta ${v.numero} no esta en borrador (esta ${v.estado})`);
    await client.query('SELECT confirmar_venta($1, $2)', [id, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: v.sucursal_id, accion: 'confirmar_venta',
      tabla: 'venta', registroId: id, detalle: { numero: v.numero } });
    const t = await client.query('SELECT subtotal, descuento, impuesto, total FROM v_venta_totales WHERE venta_id = $1', [id]);
    const lotes = await client.query(
      `SELECT vl.venta_detalle_id, m.lote_id, abs(m.cantidad_con_signo) AS cantidad
         FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id
         JOIN venta_detalle d ON d.id = vl.venta_detalle_id
        WHERE d.venta_id = $1 ORDER BY vl.venta_detalle_id, m.id`, [id]);
    return [200, { id, numero: v.numero, estado: 'confirmada', ...t.rows[0], lotes: lotes.rows }];
  });
});

// ---------- Borrar un borrador (con sus lineas) ----------

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const v = await ventaAccesible(client, req, id);
    if (!v) return [404, { error: 'Venta no encontrada' }];
    // La base rechaza ambos borrados si la venta ya esta confirmada.
    await client.query('DELETE FROM venta_detalle WHERE venta_id = $1', [id]);
    await client.query('DELETE FROM venta WHERE id = $1', [id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: v.sucursal_id, accion: 'borrar_venta_borrador',
      tabla: 'venta', registroId: id, detalle: { numero: v.numero } });
    return [200, { id, numero: v.numero, borrada: true }];
  });
});

// ---------- Pagos (solo de ventas confirmadas; la base impide pagar de mas) ----------

router.post('/:id/pagos', async (req, res, next) => {
  const b = req.body || {};
  if (!METODOS.includes(b.metodo) || !esMonto(b.monto) ||
      (b.referencia !== undefined && b.referencia !== null && !texto(b.referencia))) {
    return res.status(400).json({ error: `Datos invalidos (metodo: ${METODOS.join(', ')}; monto con maximo 2 decimales)` });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const v = await ventaAccesible(client, req, id);
    if (!v) return [404, { error: 'Venta no encontrada' }];
    const p = await client.query(
      `INSERT INTO venta_pago (venta_id, tipo, metodo, monto, referencia, usuario_id)
       VALUES ($1, 'pago', $2, $3, $4, $5) RETURNING id, tipo, metodo, monto, referencia, fecha`,
      [id, b.metodo, b.monto, b.referencia ? b.referencia.trim() : null, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: v.sucursal_id, accion: 'registrar_pago_venta',
      tabla: 'venta_pago', registroId: p.rows[0].id,
      detalle: { venta: v.numero, metodo: b.metodo, monto: b.monto } });
    const s = await client.query(
      'SELECT total, total_acreditado, pagado_neto, saldo FROM v_venta_saldo WHERE venta_id = $1', [id]);
    return [201, { ...p.rows[0], venta: s.rows[0] }];
  });
});

module.exports = router;
