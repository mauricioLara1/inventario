const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, esMonto, puedeSucursal, reglaNegocio, enTransaccion } = require('../util');

const router = express.Router();
router.use(requiereLogin, (req, res, next) =>
  (req.method === 'GET' ? requierePermiso('rentas.consultar', 'rentas.operar') : requierePermiso('rentas.operar'))(req, res, next));

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'otro'];
const TIPOS_PAGO = ['cobro', 'devolucion_deposito', 'aplicacion_deposito'];
const ESTADOS_DEVOLUCION = ['devuelta', 'danada', 'perdida'];
const ESTADOS_RENTA = ['abierta', 'cerrada', 'cancelada'];

const fechaValida = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const opcionalTexto = (v) => v === undefined || v === null || texto(v);

// Busca la renta y verifica que sea de una sucursal del usuario (si no, se responde 404).
async function rentaAccesible(db, req, id) {
  if (!esId(id)) return null;
  const r = await db.query('SELECT id, sucursal_id, numero, estado FROM renta WHERE id = $1', [id]);
  const x = r.rows[0];
  return x && puedeSucursal(req.usuario, x.sucursal_id) ? x : null;
}

// La cuenta de la renta (consumo, cobrado, deposito en poder, saldo).
async function cuenta(db, id) {
  const r = await db.query(
    `SELECT total_piezas, total_cargos, consumo, deposito_cobrado, deposito_devuelto,
            deposito_aplicado, deposito_en_poder, cobrado, saldo
       FROM v_renta_saldo WHERE renta_id = $1`, [id]);
  return r.rows[0];
}

// ---------- Listar / ver ----------

// ?sucursal_id=N  ?estado=abierta|cerrada|cancelada  ?cliente_id=N
router.get('/', async (req, res, next) => {
  try {
    const cond = [];
    const params = [];
    for (const campo of ['sucursal_id', 'cliente_id']) {
      if (req.query[campo] !== undefined) {
        const v = Number(req.query[campo]);
        if (!esId(v)) return res.status(400).json({ error: `${campo} invalido` });
        params.push(v);
        cond.push(`s.${campo} = $${params.length}`);
      }
    }
    if (req.query.estado !== undefined) {
      if (!ESTADOS_RENTA.includes(req.query.estado)) {
        return res.status(400).json({ error: `estado invalido (${ESTADOS_RENTA.join(', ')})` });
      }
      params.push(req.query.estado);
      cond.push(`s.estado = $${params.length}`);
    }
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT s.renta_id AS id, s.numero, s.sucursal_id, s.cliente_id, s.estado,
              r.fecha_inicio, r.fecha_prevista_devolucion, r.fecha_cierre,
              s.consumo, s.cobrado, s.deposito_en_poder, s.saldo
         FROM v_renta_saldo s JOIN renta r ON r.id = s.renta_id
         ${donde} ORDER BY s.renta_id DESC LIMIT 200`, params);
    res.json(r.rows.filter((x) => puedeSucursal(req.usuario, x.sucursal_id)));
  } catch (e) { next(e); }
});

// Piezas pendientes cuya fecha prevista ya paso (antes de /:id para que no choque).
router.get('/vencidas', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT renta_id, numero, sucursal_id, cliente_id, renta_detalle_id, unidad_renta_id,
              fecha_prevista_devolucion, retraso::text AS retraso
         FROM v_renta_vencida ORDER BY fecha_prevista_devolucion LIMIT 200`);
    res.json(r.rows.filter((x) => puedeSucursal(req.usuario, x.sucursal_id)));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const x = await rentaAccesible(pool, req, Number(req.params.id));
    if (!x) return res.status(404).json({ error: 'Renta no encontrada' });
    const cab = await pool.query(
      `SELECT id, numero, sucursal_id, cliente_id, usuario_abre_id, usuario_cierra_id, estado,
              fecha_inicio, fecha_prevista_devolucion, fecha_cierre
         FROM renta WHERE id = $1`, [x.id]);
    const lineas = await pool.query(
      `SELECT d.id, d.unidad_renta_id, u.codigo AS unidad, p.nombre AS producto,
              d.formato_cobro_id, d.tarifa_aplicada, d.impuesto_porcentaje, d.deposito_aplicado,
              d.estado_devolucion, d.fecha_devolucion, d.periodos_cobrados,
              d.subtotal, d.impuesto, d.total
         FROM renta_detalle d
         JOIN unidad_renta u ON u.id = d.unidad_renta_id
         JOIN producto_renta p ON p.id = u.producto_renta_id
        WHERE d.renta_id = $1 ORDER BY d.id`, [x.id]);
    const cargos = await pool.query(
      `SELECT c.id, c.renta_detalle_id, k.nombre AS concepto, c.descripcion, c.monto, c.fecha
         FROM renta_cargo c
         JOIN concepto_cargo_renta k ON k.id = c.concepto_cargo_id
         JOIN renta_detalle d ON d.id = c.renta_detalle_id
        WHERE d.renta_id = $1 ORDER BY c.id`, [x.id]);
    const pagos = await pool.query(
      `SELECT id, tipo, metodo, monto, referencia, usuario_id, fecha
         FROM renta_pago WHERE renta_id = $1 ORDER BY id`, [x.id]);
    res.json({ ...cab.rows[0], cuenta: await cuenta(pool, x.id),
               lineas: lineas.rows, cargos: cargos.rows, pagos: pagos.rows });
  } catch (e) { next(e); }
});

// ---------- Abrir: renta + piezas + deposito en una sola transaccion ----------
// La base verifica al confirmar: cliente activo y con telefono, al menos una pieza y
// el deposito exigido ya cobrado. Para exonerar el deposito: exonerar_deposito: true.

router.post('/', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.sucursal_id) || !esId(b.cliente_id) || !fechaValida(b.fecha_prevista_devolucion) ||
      !Array.isArray(b.unidades) || b.unidades.length === 0 || b.unidades.length > 50 ||
      !b.unidades.every(esId) || new Set(b.unidades).size !== b.unidades.length ||
      (b.deposito_metodo !== undefined && !METODOS.includes(b.deposito_metodo)) ||
      !opcionalTexto(b.deposito_referencia) ||
      (b.exonerar_deposito !== undefined && typeof b.exonerar_deposito !== 'boolean')) {
    return res.status(400).json({
      error: 'Datos incompletos o invalidos (sucursal_id, cliente_id, fecha_prevista_devolucion, ' +
             'unidades [ids distintos]; deposito_metodo, deposito_referencia, exonerar_deposito opcionales)' });
  }
  if (!puedeSucursal(req.usuario, b.sucursal_id)) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  const exonerar = b.exonerar_deposito === true;
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
       VALUES ($1, $2, $3, $4)
       RETURNING id, numero, sucursal_id, cliente_id, estado, fecha_inicio, fecha_prevista_devolucion`,
      [b.sucursal_id, b.cliente_id, req.usuario.id, b.fecha_prevista_devolucion]);
    const renta = r.rows[0];
    const lineas = [];
    for (const unidadId of b.unidades) {
      // La base copia formato, tarifa, impuesto y deposito de la ficha del producto.
      const l = await client.query(
        `INSERT INTO renta_detalle (renta_id, sucursal_id, unidad_renta_id, formato_cobro_id,
                                    tarifa_aplicada, impuesto_porcentaje, deposito_aplicado)
         VALUES ($1, $2, $3, NULL, NULL, NULL, $4)
         RETURNING id, unidad_renta_id, formato_cobro_id, tarifa_aplicada, impuesto_porcentaje,
                   deposito_aplicado, estado_devolucion`,
        [renta.id, b.sucursal_id, unidadId, exonerar ? 0 : null]);
      lineas.push(l.rows[0]);
    }
    const dep = await client.query(
      'SELECT COALESCE(SUM(deposito_aplicado), 0) AS total FROM renta_detalle WHERE renta_id = $1', [renta.id]);
    const requerido = dep.rows[0].total;
    if (Number(requerido) > 0) {
      if (!b.deposito_metodo) {
        throw reglaNegocio(`La renta exige deposito de ${requerido}: indique deposito_metodo (o exonerar_deposito)`);
      }
      await client.query(
        `INSERT INTO renta_pago (renta_id, tipo, metodo, monto, referencia, usuario_id)
         VALUES ($1, 'deposito', $2, $3, $4, $5)`,
        [renta.id, b.deposito_metodo, requerido,
         b.deposito_referencia ? b.deposito_referencia.trim() : null, req.usuario.id]);
    }
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: b.sucursal_id, accion: 'abrir_renta',
      tabla: 'renta', registroId: renta.id,
      detalle: { numero: renta.numero, piezas: b.unidades.length, deposito: requerido, exonerado: exonerar } });
    return [201, { ...renta, lineas, deposito_cobrado: requerido }];
  });
});

// ---------- Devolver una pieza (los periodos y el total los calcula la base) ----------
// estado: devuelta | danada | perdida. fecha y gracia_min son opcionales.

router.post('/:id/devolver', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.renta_detalle_id) || !ESTADOS_DEVOLUCION.includes(b.estado) ||
      (b.fecha !== undefined && !fechaValida(b.fecha)) ||
      (b.gracia_min !== undefined && !(Number.isInteger(b.gracia_min) && b.gracia_min >= 0))) {
    return res.status(400).json({
      error: `Datos invalidos (renta_detalle_id, estado: ${ESTADOS_DEVOLUCION.join(', ')}; fecha y gracia_min opcionales)` });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const x = await rentaAccesible(client, req, id);
    if (!x) return [404, { error: 'Renta no encontrada' }];
    const l = await client.query(
      'SELECT id FROM renta_detalle WHERE id = $1 AND renta_id = $2', [b.renta_detalle_id, id]);
    if (l.rowCount === 0) return [404, { error: 'Linea no encontrada en esta renta' }];
    const p = await client.query(
      `SELECT devolver_pieza($1, $2, COALESCE($3::timestamptz, now()), COALESCE($4::int, 0)) AS periodos`,
      [b.renta_detalle_id, b.estado, b.fecha ?? null, b.gracia_min ?? null]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: x.sucursal_id, accion: 'devolver_pieza_renta',
      tabla: 'renta_detalle', registroId: b.renta_detalle_id,
      detalle: { renta: x.numero, estado: b.estado, periodos: p.rows[0].periodos } });
    const d = await client.query(
      `SELECT d.id, d.unidad_renta_id, u.estado AS estado_unidad, d.estado_devolucion,
              d.fecha_devolucion, d.periodos_cobrados, d.subtotal, d.impuesto, d.total
         FROM renta_detalle d JOIN unidad_renta u ON u.id = d.unidad_renta_id
        WHERE d.id = $1`, [b.renta_detalle_id]);
    return [200, { ...d.rows[0], cuenta: await cuenta(client, id) }];
  });
});

// ---------- Cargos extra (dano, retraso...) sobre una pieza de la renta ----------

router.post('/:id/cargos', async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.renta_detalle_id) || !esId(b.concepto_cargo_id) || !esMonto(b.monto) ||
      !opcionalTexto(b.descripcion)) {
    return res.status(400).json({
      error: 'Datos invalidos (renta_detalle_id, concepto_cargo_id, monto con maximo 2 decimales; descripcion opcional)' });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const x = await rentaAccesible(client, req, id);
    if (!x) return [404, { error: 'Renta no encontrada' }];
    const l = await client.query(
      'SELECT id FROM renta_detalle WHERE id = $1 AND renta_id = $2', [b.renta_detalle_id, id]);
    if (l.rowCount === 0) return [404, { error: 'Linea no encontrada en esta renta' }];
    const r = await client.query(
      `INSERT INTO renta_cargo (renta_detalle_id, concepto_cargo_id, descripcion, monto, usuario_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, renta_detalle_id, concepto_cargo_id, descripcion, monto, fecha`,
      [b.renta_detalle_id, b.concepto_cargo_id, b.descripcion ? b.descripcion.trim() : null,
       b.monto, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: x.sucursal_id, accion: 'cargo_renta',
      tabla: 'renta_cargo', registroId: r.rows[0].id, detalle: { renta: x.numero, monto: b.monto } });
    return [201, { ...r.rows[0], cuenta: await cuenta(client, id) }];
  });
});

// ---------- Pagos: cobro, devolucion del deposito o aplicacion del deposito a la deuda ----------
// La base impide cobrar mas que el saldo y usar mas deposito del que se tiene.

router.post('/:id/pagos', async (req, res, next) => {
  const b = req.body || {};
  if (!TIPOS_PAGO.includes(b.tipo) || !METODOS.includes(b.metodo) || !esMonto(b.monto) ||
      !opcionalTexto(b.referencia)) {
    return res.status(400).json({
      error: `Datos invalidos (tipo: ${TIPOS_PAGO.join(', ')}; metodo: ${METODOS.join(', ')}; monto con maximo 2 decimales)` });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const x = await rentaAccesible(client, req, id);
    if (!x) return [404, { error: 'Renta no encontrada' }];
    const r = await client.query(
      `INSERT INTO renta_pago (renta_id, tipo, metodo, monto, referencia, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, tipo, metodo, monto, referencia, fecha`,
      [id, b.tipo, b.metodo, b.monto, b.referencia ? b.referencia.trim() : null, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: x.sucursal_id, accion: 'pago_renta',
      tabla: 'renta_pago', registroId: r.rows[0].id,
      detalle: { renta: x.numero, tipo: b.tipo, metodo: b.metodo, monto: b.monto } });
    return [201, { ...r.rows[0], cuenta: await cuenta(client, id) }];
  });
});

// ---------- Cerrar (todo devuelto, saldo 0 y deposito devuelto o aplicado) / cancelar ----------

router.post('/:id/cerrar', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const x = await rentaAccesible(client, req, id);
    if (!x) return [404, { error: 'Renta no encontrada' }];
    if (x.estado !== 'abierta') throw reglaNegocio(`La renta ${x.numero} no esta abierta (esta ${x.estado})`);
    await client.query('SELECT cerrar_renta($1, $2)', [id, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: x.sucursal_id, accion: 'cerrar_renta',
      tabla: 'renta', registroId: id, detalle: { numero: x.numero } });
    return [200, { id, numero: x.numero, estado: 'cerrada', cuenta: await cuenta(client, id) }];
  });
});

// Solo si no se devolvio ninguna pieza; el deposito debe estar devuelto antes.
router.post('/:id/cancelar', async (req, res, next) => {
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const x = await rentaAccesible(client, req, id);
    if (!x) return [404, { error: 'Renta no encontrada' }];
    if (x.estado !== 'abierta') throw reglaNegocio(`La renta ${x.numero} no esta abierta (esta ${x.estado})`);
    await client.query("UPDATE renta SET estado = 'cancelada' WHERE id = $1", [id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: x.sucursal_id, accion: 'cancelar_renta',
      tabla: 'renta', registroId: id, detalle: { numero: x.numero } });
    return [200, { id, numero: x.numero, estado: 'cancelada', cuenta: await cuenta(client, id) }];
  });
});

module.exports = router;
