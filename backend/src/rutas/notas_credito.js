const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, esMonto, puedeSucursal, reglaNegocio, enTransaccion } = require('../util');

const router = express.Router();
router.use(requiereLogin, requierePermiso('notas_credito.gestionar'));

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'otro'];

// Busca la nota y verifica que sea de una sucursal del usuario (si no, se responde 404).
async function notaAccesible(db, req, id) {
  if (!esId(id)) return null;
  const r = await db.query(
    'SELECT id, venta_id, sucursal_id, estado, numero FROM nota_credito WHERE id = $1', [id]);
  const n = r.rows[0];
  return n && puedeSucursal(req.usuario, n.sucursal_id) ? n : null;
}

// ---------- Listar / ver ----------

// ?venta_id=N  ?estado=borrador|confirmada
router.get('/', async (req, res, next) => {
  try {
    const cond = [];
    const params = [];
    if (req.query.venta_id !== undefined) {
      const v = Number(req.query.venta_id);
      if (!esId(v)) return res.status(400).json({ error: 'venta_id invalido' });
      params.push(v);
      cond.push(`t.venta_id = $${params.length}`);
    }
    if (req.query.estado !== undefined) {
      if (!['borrador', 'confirmada'].includes(req.query.estado)) {
        return res.status(400).json({ error: 'estado invalido (borrador o confirmada)' });
      }
      params.push(req.query.estado);
      cond.push(`t.estado = $${params.length}`);
    }
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT t.nota_credito_id AS id, t.numero, t.venta_id, t.sucursal_id, t.estado,
              n.motivo, n.fecha, t.subtotal, t.descuento, t.impuesto, t.total
         FROM v_nota_credito_totales t JOIN nota_credito n ON n.id = t.nota_credito_id
         ${donde} ORDER BY t.nota_credito_id DESC LIMIT 200`, params);
    res.json(r.rows.filter((n) => puedeSucursal(req.usuario, n.sucursal_id)));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const n = await notaAccesible(pool, req, Number(req.params.id));
    if (!n) return res.status(404).json({ error: 'Nota credito no encontrada' });
    const cab = await pool.query(
      `SELECT t.nota_credito_id AS id, t.numero, t.venta_id, t.sucursal_id, t.estado,
              n.motivo, n.fecha, n.emitida_por, t.subtotal, t.descuento, t.impuesto, t.total
         FROM v_nota_credito_totales t JOIN nota_credito n ON n.id = t.nota_credito_id
        WHERE t.nota_credito_id = $1`, [n.id]);
    const lineas = await pool.query(
      `SELECT d.id, d.venta_detalle_id, vd.producto_id, d.cantidad, d.subtotal, d.descuento,
              d.impuesto, d.total,
              COALESCE((SELECT SUM(r.cantidad) FROM nota_credito_reingreso r
                         WHERE r.nota_credito_detalle_id = d.id), 0) AS reingresado
         FROM nota_credito_detalle d JOIN venta_detalle vd ON vd.id = d.venta_detalle_id
        WHERE d.nota_credito_id = $1 ORDER BY d.id`, [n.id]);
    const reembolsos = await pool.query(
      `SELECT id, metodo, monto, referencia, fecha FROM venta_pago
        WHERE nota_credito_id = $1 AND tipo = 'reembolso' ORDER BY id`, [n.id]);
    res.json({ ...cab.rows[0], lineas: lineas.rows, reembolsos: reembolsos.rows });
  } catch (e) { next(e); }
});

// ---------- Crear borrador (solo sobre ventas confirmadas; lo exige la base) ----------

router.post('/', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.venta_id) || !texto(b.motivo)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (venta_id y motivo)' });
  }
  await enTransaccion(res, next, async (client) => {
    const v = await client.query('SELECT id, sucursal_id, numero FROM venta WHERE id = $1', [b.venta_id]);
    const venta = v.rows[0];
    if (!venta || !puedeSucursal(req.usuario, venta.sucursal_id)) {
      return [404, { error: 'Venta no encontrada' }];
    }
    const r = await client.query(
      `INSERT INTO nota_credito (venta_id, sucursal_id, emitida_por, motivo)
       VALUES ($1, $2, $3, $4)
       RETURNING id, numero, venta_id, sucursal_id, motivo, estado, fecha`,
      [venta.id, venta.sucursal_id, req.usuario.id, b.motivo.trim()]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: venta.sucursal_id, accion: 'crear_nota_credito',
      tabla: 'nota_credito', registroId: r.rows[0].id,
      detalle: { numero: r.rows[0].numero, venta: venta.numero } });
    return [201, r.rows[0]];
  });
});

// ---------- Lineas (solo en borrador). La base calcula los importes en proporcion. ----------

router.post('/:id/lineas', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.venta_detalle_id) || typeof b.cantidad !== 'number' || !(b.cantidad > 0)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (venta_detalle_id y cantidad)' });
  }
  try {
    const n = await notaAccesible(pool, req, Number(req.params.id));
    if (!n) return res.status(404).json({ error: 'Nota credito no encontrada' });
    const r = await pool.query(
      `INSERT INTO nota_credito_detalle (nota_credito_id, venta_id, sucursal_id, venta_detalle_id,
                                         cantidad, subtotal, descuento, impuesto, total)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, NULL, NULL)
       RETURNING id, venta_detalle_id, cantidad, subtotal, descuento, impuesto, total`,
      [n.id, n.venta_id, n.sucursal_id, b.venta_detalle_id, b.cantidad]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/lineas/:lineaId', async (req, res, next) => {
  try {
    const n = await notaAccesible(pool, req, Number(req.params.id));
    const lineaId = Number(req.params.lineaId);
    if (!n || !esId(lineaId)) return res.status(404).json({ error: 'Nota credito no encontrada' });
    const r = await pool.query(
      'DELETE FROM nota_credito_detalle WHERE id = $1 AND nota_credito_id = $2', [lineaId, n.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Linea no encontrada' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- Confirmar (la base exige que tenga al menos una linea) ----------

router.post('/:id/confirmar', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const n = await notaAccesible(client, req, id);
    if (!n) return [404, { error: 'Nota credito no encontrada' }];
    if (n.estado !== 'borrador') {
      throw reglaNegocio(`La nota ${n.numero} no esta en borrador (esta ${n.estado})`);
    }
    await client.query("UPDATE nota_credito SET estado = 'confirmada' WHERE id = $1", [id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: n.sucursal_id, accion: 'confirmar_nota_credito',
      tabla: 'nota_credito', registroId: id, detalle: { numero: n.numero } });
    const t = await client.query(
      'SELECT subtotal, descuento, impuesto, total FROM v_nota_credito_totales WHERE nota_credito_id = $1', [id]);
    const s = await client.query(
      'SELECT total, total_acreditado, pagado_neto, saldo FROM v_venta_saldo WHERE venta_id = $1', [n.venta_id]);
    return [200, { id, numero: n.numero, estado: 'confirmada', ...t.rows[0], venta: s.rows[0] }];
  });
});

// ---------- Borrar un borrador (con sus lineas) ----------

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const n = await notaAccesible(client, req, id);
    if (!n) return [404, { error: 'Nota credito no encontrada' }];
    // La base rechaza ambos borrados si la nota ya esta confirmada.
    await client.query('DELETE FROM nota_credito_detalle WHERE nota_credito_id = $1', [id]);
    await client.query('DELETE FROM nota_credito WHERE id = $1', [id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: n.sucursal_id, accion: 'borrar_nota_credito_borrador',
      tabla: 'nota_credito', registroId: id, detalle: { numero: n.numero } });
    return [200, { id, numero: n.numero, borrada: true }];
  });
});

// ---------- Reingreso fisico al stock (nota confirmada; la base reparte entre los lotes de origen) ----------

router.post('/:id/reingresos', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.nota_credito_detalle_id) || typeof b.cantidad !== 'number' || !(b.cantidad > 0)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (nota_credito_detalle_id y cantidad)' });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const n = await notaAccesible(client, req, id);
    if (!n) return [404, { error: 'Nota credito no encontrada' }];
    const l = await client.query(
      'SELECT id FROM nota_credito_detalle WHERE id = $1 AND nota_credito_id = $2',
      [b.nota_credito_detalle_id, id]);
    if (l.rowCount === 0) return [404, { error: 'Linea no encontrada en esta nota' }];
    await client.query('SELECT reingresar_stock($1, $2, $3)', [b.nota_credito_detalle_id, b.cantidad, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: n.sucursal_id, accion: 'reingresar_stock_nota_credito',
      tabla: 'nota_credito_detalle', registroId: b.nota_credito_detalle_id,
      detalle: { nota: n.numero, cantidad: b.cantidad } });
    const r = await client.query(
      `SELECT d.id AS nota_credito_detalle_id, d.cantidad AS acreditado,
              COALESCE((SELECT SUM(r.cantidad) FROM nota_credito_reingreso r
                         WHERE r.nota_credito_detalle_id = d.id), 0) AS reingresado
         FROM nota_credito_detalle d WHERE d.id = $1`, [b.nota_credito_detalle_id]);
    return [201, r.rows[0]];
  });
});

// ---------- Reembolso (venta_pago tipo reembolso; la base no deja devolver de mas) ----------

router.post('/:id/reembolsos', async (req, res, next) => {
  const b = req.body || {};
  if (!METODOS.includes(b.metodo) || !esMonto(b.monto) ||
      (b.referencia !== undefined && b.referencia !== null && !texto(b.referencia))) {
    return res.status(400).json({ error: `Datos invalidos (metodo: ${METODOS.join(', ')}; monto con maximo 2 decimales)` });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const n = await notaAccesible(client, req, id);
    if (!n) return [404, { error: 'Nota credito no encontrada' }];
    const p = await client.query(
      `INSERT INTO venta_pago (venta_id, nota_credito_id, tipo, metodo, monto, referencia, usuario_id)
       VALUES ($1, $2, 'reembolso', $3, $4, $5, $6)
       RETURNING id, tipo, metodo, monto, referencia, fecha`,
      [n.venta_id, id, b.metodo, b.monto, b.referencia ? b.referencia.trim() : null, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: n.sucursal_id, accion: 'registrar_reembolso',
      tabla: 'venta_pago', registroId: p.rows[0].id,
      detalle: { nota: n.numero, metodo: b.metodo, monto: b.monto } });
    const s = await client.query(
      'SELECT total, total_acreditado, pagado_neto, saldo FROM v_venta_saldo WHERE venta_id = $1', [n.venta_id]);
    return [201, { ...p.rows[0], venta: s.rows[0] }];
  });
});

module.exports = router;
