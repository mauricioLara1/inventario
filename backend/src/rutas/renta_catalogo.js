const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, puedeSucursal, enTransaccion } = require('../util');

const router = express.Router();
router.use(requiereLogin, (req, res, next) =>
  (req.method === 'GET' ? requierePermiso('rentas.consultar', 'rentas.catalogo', 'rentas.operar')(req, res, next) : next()));

// Dinero no negativo con maximo 2 decimales (el precio o el deposito pueden ser 0).
const esDinero = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 &&
  Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const esPorcentaje = (n) => typeof n === 'number' && n >= 0 && n <= 100;
const opcionalTexto = (v) => v === undefined || v === null || texto(v);

const ESTADOS = ['disponible', 'rentada', 'mantenimiento', 'retirada'];
const ESTADOS_MANUALES = ['disponible', 'mantenimiento', 'retirada'];

// ---------- Formatos de cobro (los carga el seed: hora, dia, semana) ----------

router.get('/formatos', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id, nombre, minutos_periodo FROM formato_cobro ORDER BY minutos_periodo');
    res.json(r.rows);
  } catch (e) { next(e); }
});

// ---------- Conceptos de cargo (dano, retraso...) ----------

router.get('/conceptos', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id, nombre, descripcion, activo FROM concepto_cargo_renta ORDER BY nombre');
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/conceptos', requierePermiso('rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  if (!texto(b.nombre) || !opcionalTexto(b.descripcion)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (nombre; descripcion opcional)' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO concepto_cargo_renta (nombre, descripcion) VALUES ($1, $2)
       RETURNING id, nombre, descripcion, activo`,
      [b.nombre.trim(), b.descripcion ? b.descripcion.trim() : null]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'crear_concepto_cargo_renta',
      tabla: 'concepto_cargo_renta', registroId: r.rows[0].id, detalle: { nombre: r.rows[0].nombre } });
    return [201, r.rows[0]];
  });
});

// ---------- Categorias de renta ----------

router.get('/categorias', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id, nombre, descripcion, activo FROM categoria_renta ORDER BY nombre');
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/categorias', requierePermiso('rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  if (!texto(b.nombre) || !opcionalTexto(b.descripcion)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (nombre; descripcion opcional)' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO categoria_renta (nombre, descripcion) VALUES ($1, $2)
       RETURNING id, nombre, descripcion, activo`,
      [b.nombre.trim(), b.descripcion ? b.descripcion.trim() : null]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'crear_categoria_renta',
      tabla: 'categoria_renta', registroId: r.rows[0].id, detalle: { nombre: r.rows[0].nombre } });
    return [201, r.rows[0]];
  });
});

// ---------- Productos de renta (la ficha: tarifa por periodo, impuesto, deposito, reposicion) ----------

// ?categoria_id=N  ?activo=true|false
router.get('/productos', async (req, res, next) => {
  try {
    const cond = [];
    const params = [];
    if (req.query.categoria_id !== undefined) {
      const c = Number(req.query.categoria_id);
      if (!esId(c)) return res.status(400).json({ error: 'categoria_id invalido' });
      params.push(c);
      cond.push(`p.categoria_renta_id = $${params.length}`);
    }
    if (req.query.activo !== undefined) {
      if (!['true', 'false'].includes(req.query.activo)) {
        return res.status(400).json({ error: 'activo invalido (true o false)' });
      }
      params.push(req.query.activo === 'true');
      cond.push(`p.activo = $${params.length}`);
    }
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT p.id, p.categoria_renta_id, c.nombre AS categoria, p.codigo, p.nombre,
              p.formato_cobro_id, f.nombre AS formato, p.precio, p.impuesto_porcentaje,
              p.deposito, p.reposicion, p.activo
         FROM producto_renta p
         JOIN categoria_renta c ON c.id = p.categoria_renta_id
         JOIN formato_cobro f ON f.id = p.formato_cobro_id
         ${donde} ORDER BY p.nombre LIMIT 500`, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/productos', requierePermiso('rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  const imp = b.impuesto_porcentaje === undefined ? 0 : b.impuesto_porcentaje;
  const dep = b.deposito === undefined ? 0 : b.deposito;
  const rep = b.reposicion === undefined ? 0 : b.reposicion;
  if (!esId(b.categoria_renta_id) || !texto(b.codigo) || !texto(b.nombre) ||
      !esId(b.formato_cobro_id) || !esDinero(b.precio) ||
      !esPorcentaje(imp) || !esDinero(dep) || !esDinero(rep)) {
    return res.status(400).json({
      error: 'Datos incompletos o invalidos (categoria_renta_id, codigo, nombre, formato_cobro_id, precio; ' +
             'opcionales: impuesto_porcentaje, deposito, reposicion)' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO producto_renta (categoria_renta_id, codigo, nombre, formato_cobro_id, precio,
                                   impuesto_porcentaje, deposito, reposicion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, categoria_renta_id, codigo, nombre, formato_cobro_id, precio,
                 impuesto_porcentaje, deposito, reposicion, activo`,
      [b.categoria_renta_id, b.codigo.trim(), b.nombre.trim(), b.formato_cobro_id, b.precio, imp, dep, rep]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'crear_producto_renta',
      tabla: 'producto_renta', registroId: r.rows[0].id, detalle: { codigo: r.rows[0].codigo } });
    return [201, r.rows[0]];
  });
});

// ---------- Unidades (cada pieza fisica) ----------

// Busca la unidad y verifica que sea de una sucursal del usuario (si no, se responde 404).
async function unidadAccesible(db, req, id) {
  if (!esId(id)) return null;
  const r = await db.query('SELECT id, sucursal_id, codigo, estado FROM unidad_renta WHERE id = $1', [id]);
  const u = r.rows[0];
  return u && puedeSucursal(req.usuario, u.sucursal_id) ? u : null;
}

// ?sucursal_id=N  ?estado=disponible|rentada|mantenimiento|retirada  ?producto_renta_id=N
router.get('/unidades', async (req, res, next) => {
  try {
    const cond = [];
    const params = [];
    for (const campo of ['sucursal_id', 'producto_renta_id']) {
      if (req.query[campo] !== undefined) {
        const v = Number(req.query[campo]);
        if (!esId(v)) return res.status(400).json({ error: `${campo} invalido` });
        params.push(v);
        cond.push(`u.${campo} = $${params.length}`);
      }
    }
    if (req.query.estado !== undefined) {
      if (!ESTADOS.includes(req.query.estado)) {
        return res.status(400).json({ error: `estado invalido (${ESTADOS.join(', ')})` });
      }
      params.push(req.query.estado);
      cond.push(`u.estado = $${params.length}`);
    }
    const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT u.id, u.codigo, u.estado, u.sucursal_id, u.producto_renta_id,
              p.codigo AS producto_codigo, p.nombre AS producto
         FROM unidad_renta u JOIN producto_renta p ON p.id = u.producto_renta_id
         ${donde} ORDER BY u.codigo LIMIT 500`, params);
    res.json(r.rows.filter((u) => puedeSucursal(req.usuario, u.sucursal_id)));
  } catch (e) { next(e); }
});

router.post('/unidades', requierePermiso('rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.producto_renta_id) || !esId(b.sucursal_id) || !texto(b.codigo)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos (producto_renta_id, sucursal_id, codigo)' });
  }
  if (!puedeSucursal(req.usuario, b.sucursal_id)) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO unidad_renta (producto_renta_id, sucursal_id, codigo) VALUES ($1, $2, $3)
       RETURNING id, producto_renta_id, sucursal_id, codigo, estado`,
      [b.producto_renta_id, b.sucursal_id, b.codigo.trim()]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: b.sucursal_id, accion: 'crear_unidad_renta',
      tabla: 'unidad_renta', registroId: r.rows[0].id, detalle: { codigo: r.rows[0].codigo } });
    return [201, r.rows[0]];
  });
});

// Cambio manual de estado. "rentada" no se pone ni se quita a mano: la base lo rechaza.
router.put('/unidades/:id/estado', requierePermiso('rentas.estado_piezas', 'rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  if (!ESTADOS_MANUALES.includes(b.estado)) {
    return res.status(400).json({ error: `Estado invalido (${ESTADOS_MANUALES.join(', ')})` });
  }
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const u = await unidadAccesible(client, req, id);
    if (!u) return [404, { error: 'Unidad no encontrada' }];
    const r = await client.query(
      'UPDATE unidad_renta SET estado = $1 WHERE id = $2 RETURNING id, codigo, estado', [b.estado, id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: u.sucursal_id, accion: 'cambiar_estado_unidad_renta',
      tabla: 'unidad_renta', registroId: id, detalle: { codigo: u.codigo, de: u.estado, a: b.estado } });
    return [200, r.rows[0]];
  });
});

// ---------- Notas de la unidad (bitacora: danos, reparaciones...) ----------

router.get('/unidades/:id/notas', async (req, res, next) => {
  try {
    const u = await unidadAccesible(pool, req, Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'Unidad no encontrada' });
    const r = await pool.query(
      `SELECT id, usuario_id, comentario, fecha FROM unidad_renta_nota
        WHERE unidad_renta_id = $1 ORDER BY fecha DESC LIMIT 200`, [u.id]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/unidades/:id/notas', requierePermiso('rentas.estado_piezas', 'rentas.catalogo'), async (req, res, next) => {
  const b = req.body || {};
  if (!texto(b.comentario)) return res.status(400).json({ error: 'Falta el comentario' });
  const id = Number(req.params.id);
  await enTransaccion(res, next, async (client) => {
    const u = await unidadAccesible(client, req, id);
    if (!u) return [404, { error: 'Unidad no encontrada' }];
    const r = await client.query(
      `INSERT INTO unidad_renta_nota (unidad_renta_id, usuario_id, comentario) VALUES ($1, $2, $3)
       RETURNING id, comentario, fecha`, [id, req.usuario.id, b.comentario.trim()]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: u.sucursal_id, accion: 'nota_unidad_renta',
      tabla: 'unidad_renta_nota', registroId: r.rows[0].id, detalle: { unidad: u.codigo } });
    return [201, r.rows[0]];
  });
});

module.exports = router;
