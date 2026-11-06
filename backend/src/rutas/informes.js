const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { esId, puedeSucursal } = require('../util');

// Informes de solo lectura: casi todo sale de las vistas de la base.
const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

// Los dias se cuentan en la hora de Colombia, no en la del servidor.
const ZONA = 'America/Bogota';

const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// Lee ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sucursal_id=N. Sin fechas: ultimos 30 dias.
function filtros(req) {
  const q = req.query;
  if (q.desde !== undefined && !esFecha(q.desde)) return { error: 'desde invalido (YYYY-MM-DD)' };
  if (q.hasta !== undefined && !esFecha(q.hasta)) return { error: 'hasta invalido (YYYY-MM-DD)' };
  let sucursal = null;
  if (q.sucursal_id !== undefined) {
    sucursal = Number(q.sucursal_id);
    if (!esId(sucursal)) return { error: 'sucursal_id invalido' };
    if (!puedeSucursal(req.usuario, sucursal)) return { error: 'Esa sucursal no es tuya', estado: 403 };
  }
  return { desde: q.desde ?? null, hasta: q.hasta ?? null, sucursal };
}

const propias = (req, filas) => filas.filter((f) => puedeSucursal(req.usuario, f.sucursal_id));

// ---------- Ventas confirmadas por sucursal ----------
// ?agrupar=dia para verlas dia por dia. Lo acreditado se cuenta en la fecha de la venta original.

router.get('/ventas', async (req, res, next) => {
  try {
    const f = filtros(req);
    if (f.error) return res.status(f.estado || 400).json({ error: f.error });
    const porDia = req.query.agrupar === 'dia';
    if (req.query.agrupar !== undefined && !porDia) {
      return res.status(400).json({ error: 'agrupar invalido (dia)' });
    }
    const dia = `(v.fecha AT TIME ZONE '${ZONA}')::date`;
    const r = await pool.query(
      `SELECT v.sucursal_id, ${porDia ? `${dia}::text AS dia,` : ''}
              COUNT(*) AS ventas, SUM(t.subtotal) AS subtotal, SUM(t.descuento) AS descuento,
              SUM(t.impuesto) AS impuesto, SUM(t.total) AS total,
              SUM(s.total_acreditado) AS total_acreditado, SUM(s.deuda_neta) AS neto
         FROM venta v
         JOIN v_venta_totales t ON t.venta_id = v.id
         JOIN v_venta_saldo s ON s.venta_id = v.id
        WHERE v.estado = 'confirmada'
          AND ${dia} BETWEEN COALESCE($1::date, CURRENT_DATE - 30) AND COALESCE($2::date, CURRENT_DATE)
          AND ($3::bigint IS NULL OR v.sucursal_id = $3)
        GROUP BY v.sucursal_id${porDia ? `, ${dia}` : ''}
        ORDER BY v.sucursal_id${porDia ? `, ${dia}` : ''}`,
      [f.desde, f.hasta, f.sucursal]);
    res.json(propias(req, r.rows));
  } catch (e) { next(e); }
});

// ---------- Margen por producto (costo real de los lotes; descuenta lo acreditado) ----------

router.get('/margenes', async (req, res, next) => {
  try {
    const f = filtros(req);
    if (f.error) return res.status(f.estado || 400).json({ error: f.error });
    const r = await pool.query(
      `SELECT m.sucursal_id, m.producto_id, p.codigo, p.nombre,
              SUM(m.cantidad) AS cantidad_vendida, SUM(m.cantidad_acreditada) AS cantidad_acreditada,
              SUM(m.ingreso_neto) AS ingreso_neto, SUM(m.costo) AS costo, SUM(m.margen) AS margen
         FROM v_venta_margen m
         JOIN venta v ON v.id = m.venta_id
         JOIN producto p ON p.id = m.producto_id
        WHERE (v.fecha AT TIME ZONE '${ZONA}')::date
              BETWEEN COALESCE($1::date, CURRENT_DATE - 30) AND COALESCE($2::date, CURRENT_DATE)
          AND ($3::bigint IS NULL OR m.sucursal_id = $3)
        GROUP BY m.sucursal_id, m.producto_id, p.codigo, p.nombre
        ORDER BY SUM(m.margen) DESC LIMIT 500`,
      [f.desde, f.hasta, f.sucursal]);
    res.json(propias(req, r.rows));
  } catch (e) { next(e); }
});

// ---------- Stock bajo (lo vendible, sin lo vencido, esta en el minimo o por debajo) ----------

router.get('/stock-bajo', async (req, res, next) => {
  try {
    const f = filtros(req);
    if (f.error) return res.status(f.estado || 400).json({ error: f.error });
    const r = await pool.query(
      `SELECT s.sucursal_id, s.producto_id, p.codigo, p.nombre, s.cantidad, s.cantidad_vencida,
              s.cantidad_vendible, s.stock_minimo
         FROM v_stock s JOIN producto p ON p.id = s.producto_id
        WHERE s.stock_bajo AND ($1::bigint IS NULL OR s.sucursal_id = $1)
        ORDER BY s.sucursal_id, p.nombre LIMIT 500`, [f.sucursal]);
    res.json(propias(req, r.rows));
  } catch (e) { next(e); }
});

// ---------- Lotes por vencer: ?dias=30 (por defecto). Incluye los ya vencidos con saldo ----------

router.get('/por-vencer', async (req, res, next) => {
  try {
    const f = filtros(req);
    if (f.error) return res.status(f.estado || 400).json({ error: f.error });
    const dias = req.query.dias === undefined ? 30 : Number(req.query.dias);
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
      return res.status(400).json({ error: 'dias invalido (entero de 0 a 365)' });
    }
    const r = await pool.query(
      `SELECT d.sucursal_id, d.lote_id, d.producto_id, p.codigo, p.nombre, d.saldo,
              d.fecha_caducidad::text AS fecha_caducidad, d.dias_para_vencer, d.vencido,
              d.costo_unitario, round(d.saldo * d.costo_unitario, 2) AS valor_en_riesgo
         FROM v_lote_detalle d JOIN producto p ON p.id = d.producto_id
        WHERE d.saldo > 0 AND d.fecha_caducidad IS NOT NULL AND d.dias_para_vencer <= $1
          AND ($2::bigint IS NULL OR d.sucursal_id = $2)
        ORDER BY d.fecha_caducidad, d.lote_id LIMIT 500`, [dias, f.sucursal]);
    res.json(propias(req, r.rows));
  } catch (e) { next(e); }
});

// ---------- Cuadre de integridad: DEBE devolver una lista vacia (solo owner) ----------

router.get('/cuadre', requiereNivel(100), async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM v_cuadre_lote ORDER BY lote_id LIMIT 500');
    res.json({ cuadra: r.rows.length === 0, descuadres: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
