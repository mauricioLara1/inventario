const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requiereLogin);

const { esId, puedeSucursal } = require('../util');

// Todas las consultas exigen ?sucursal_id=N y que esa sucursal sea del usuario (el owner ve cualquiera).
function sucursalDe(req, res) {
  const sucursalId = Number(req.query.sucursal_id);
  if (!esId(sucursalId)) {
    res.status(400).json({ error: 'Falta sucursal_id' });
    return null;
  }
  if (!puedeSucursal(req.usuario, sucursalId)) {
    res.status(403).json({ error: 'Esa sucursal no es tuya' });
    return null;
  }
  return sucursalId;
}

const productoDe = (req) => {
  if (req.query.producto_id === undefined) return null;
  const id = Number(req.query.producto_id);
  return esId(id) ? id : NaN;
};

// Stock por producto. ?q=texto  ?bajo=true (solo los que estan en o bajo el minimo)
router.get('/stock', async (req, res, next) => {
  try {
    const sucursalId = sucursalDe(req, res);
    if (sucursalId === null) return;
    const q = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%';
    const soloBajo = req.query.bajo === 'true';
    const r = await pool.query(
      `SELECT s.producto_id, p.codigo, p.nombre, p.medida, s.cantidad, s.cantidad_vencida,
              s.cantidad_vendible, s.stock_minimo, s.stock_bajo
         FROM v_stock s JOIN producto p ON p.id = s.producto_id
        WHERE s.sucursal_id = $1
          AND (p.nombre ILIKE $2 OR p.codigo ILIKE $2)
          AND (NOT $3 OR s.stock_bajo)
        ORDER BY p.nombre`, [sucursalId, q, soloBajo]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Lotes (orden FEFO: primero los que vencen antes). ?producto_id=N  ?todos=true incluye los agotados.
router.get('/lotes', async (req, res, next) => {
  try {
    const sucursalId = sucursalDe(req, res);
    if (sucursalId === null) return;
    const productoId = productoDe(req);
    if (Number.isNaN(productoId)) return res.status(400).json({ error: 'producto_id invalido' });
    const todos = req.query.todos === 'true';
    const r = await pool.query(
      `SELECT l.lote_id, l.producto_id, p.codigo, p.nombre, l.compra_id, l.proveedor_id,
              l.costo_unitario, l.cantidad_inicial, l.saldo, l.fecha_compra,
              l.fecha_caducidad, l.dias_para_vencer, l.vencido
         FROM v_lote_detalle l JOIN producto p ON p.id = l.producto_id
        WHERE l.sucursal_id = $1
          AND ($2::bigint IS NULL OR l.producto_id = $2)
          AND ($3 OR l.saldo > 0)
        ORDER BY l.fecha_caducidad NULLS LAST, l.fecha_compra, l.lote_id
        LIMIT 500`, [sucursalId, productoId, todos]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Kardex: historial de movimientos, el mas reciente primero. ?producto_id=N  ?limite=N (max 500)
router.get('/kardex', async (req, res, next) => {
  try {
    const sucursalId = sucursalDe(req, res);
    if (sucursalId === null) return;
    const productoId = productoDe(req);
    if (Number.isNaN(productoId)) return res.status(400).json({ error: 'producto_id invalido' });
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);
    const r = await pool.query(
      `SELECT k.movimiento_id, k.fecha, k.producto_id, p.nombre, k.lote_id, k.tipo, k.motivo,
              k.cantidad, k.costo_unitario, k.valor, k.usuario_id, u.usuario
         FROM v_kardex k
         JOIN producto p ON p.id = k.producto_id
         JOIN usuario u ON u.id = k.usuario_id
        WHERE k.sucursal_id = $1 AND ($2::bigint IS NULL OR k.producto_id = $2)
        ORDER BY k.movimiento_id DESC LIMIT $3`, [sucursalId, productoId, limite]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

module.exports = router;
