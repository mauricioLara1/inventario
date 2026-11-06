const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, puedeSucursal, enTransaccion } = require('../util');

// Bajas y ajustes manuales de inventario: movimientos del kardex sobre un lote, siempre con motivo.
// El saldo del lote lo mueve la base; si quedara en negativo falla con INV01 (409).
const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

const TIPOS = ['baja', 'ajuste'];

// Cantidad con maximo 3 decimales, como el kardex (NUMERIC(12,3)).
const esCantidad = (n) => typeof n === 'number' && Number.isFinite(n) && n !== 0 && Math.abs(n) < 1e9 &&
  Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

// ---------- Registrar ----------
// baja:   cantidad positiva (sale del lote; se guarda en negativo).
// ajuste: cantidad con signo (positiva suma, negativa resta), para corregir un conteo.

router.post('/', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.lote_id) || !TIPOS.includes(b.tipo) || !esCantidad(b.cantidad) ||
      (b.tipo === 'baja' && b.cantidad < 0) || !texto(b.motivo)) {
    return res.status(400).json({
      error: 'Datos invalidos (lote_id; tipo: baja o ajuste; cantidad con maximo 3 decimales, ' +
             'positiva en baja y con signo en ajuste; motivo obligatorio)' });
  }
  await enTransaccion(res, next, async (client) => {
    const l = await client.query('SELECT id, sucursal_id, producto_id FROM lote WHERE id = $1', [b.lote_id]);
    const lote = l.rows[0];
    if (!lote || !puedeSucursal(req.usuario, lote.sucursal_id)) return [404, { error: 'Lote no encontrado' }];
    const firmada = b.tipo === 'baja' ? -b.cantidad : b.cantidad;
    const m = await client.query(
      `INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, motivo, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, lote_id, producto_id, tipo, cantidad_con_signo, motivo, fecha`,
      [lote.id, lote.sucursal_id, lote.producto_id, b.tipo, firmada, b.motivo.trim(), req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: lote.sucursal_id, accion: `${b.tipo}_inventario`,
      tabla: 'movimiento', registroId: m.rows[0].id,
      detalle: { lote: lote.id, cantidad: firmada, motivo: b.motivo.trim() } });
    const s = await client.query('SELECT cantidad_actual FROM lote_saldo WHERE lote_id = $1', [lote.id]);
    return [201, { ...m.rows[0], saldo_lote: s.rows[0].cantidad_actual }];
  });
});

// ---------- Historial de bajas y ajustes ----------
// ?sucursal_id=N  ?tipo=baja|ajuste

router.get('/', async (req, res, next) => {
  try {
    let sucursal = null;
    if (req.query.sucursal_id !== undefined) {
      sucursal = Number(req.query.sucursal_id);
      if (!esId(sucursal)) return res.status(400).json({ error: 'sucursal_id invalido' });
      if (!puedeSucursal(req.usuario, sucursal)) return res.status(403).json({ error: 'Esa sucursal no es tuya' });
    }
    if (req.query.tipo !== undefined && !TIPOS.includes(req.query.tipo)) {
      return res.status(400).json({ error: 'tipo invalido (baja o ajuste)' });
    }
    const r = await pool.query(
      `SELECT k.movimiento_id, k.fecha, k.sucursal_id, k.producto_id, p.codigo, p.nombre, k.lote_id,
              k.tipo, k.cantidad, k.costo_unitario, k.valor, k.motivo, k.usuario_id
         FROM v_kardex k JOIN producto p ON p.id = k.producto_id
        WHERE k.tipo IN ('baja', 'ajuste')
          AND ($1::bigint IS NULL OR k.sucursal_id = $1)
          AND ($2::text IS NULL OR k.tipo = $2)
        ORDER BY k.movimiento_id DESC LIMIT 200`,
      [sucursal, req.query.tipo ?? null]);
    res.json(r.rows.filter((x) => puedeSucursal(req.usuario, x.sucursal_id)));
  } catch (e) { next(e); }
});

module.exports = router;
