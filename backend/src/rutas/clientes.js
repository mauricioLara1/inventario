const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, enTransaccion } = require('../util');

const router = express.Router();
router.use(requiereLogin);

// Campo opcional: puede faltar, venir null o ser un texto no vacio.
const opcional = (x) => x === undefined || x === null || texto(x);
const limpio = (x) => (texto(x) ? x.trim() : null);

const COLUMNAS = `id, nombre, tipo_documento, numero_documento, telefono, correo,
                  bloqueado, motivo_bloqueo, activo`;

// Lista: ?q=texto busca por nombre, documento o telefono.
router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%';
    const r = await pool.query(
      `SELECT ${COLUMNAS} FROM cliente
        WHERE activo AND (nombre ILIKE $1 OR numero_documento ILIKE $1 OR telefono ILIKE $1)
        ORDER BY nombre LIMIT 200`, [q]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!esId(id)) return res.status(404).json({ error: 'Cliente no encontrado' });
    const r = await pool.query(`SELECT ${COLUMNAS} FROM cliente WHERE id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// Crea un cliente. El documento va completo (tipo y numero) o no va.
router.post('/', requierePermiso('clientes.crear'), async (req, res, next) => {
  const b = req.body || {};
  if (!texto(b.nombre) || !opcional(b.tipo_documento) || !opcional(b.numero_documento) ||
      !opcional(b.telefono) || !opcional(b.correo)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  const tipo = limpio(b.tipo_documento) ? b.tipo_documento.trim().toUpperCase() : null;
  const numero = limpio(b.numero_documento);
  if ((tipo === null) !== (numero === null)) {
    return res.status(400).json({ error: 'El documento va completo: tipo_documento y numero_documento' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `INSERT INTO cliente (nombre, tipo_documento, numero_documento, telefono, correo)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNAS}`,
      [b.nombre.trim(), tipo, numero, limpio(b.telefono), limpio(b.correo)]);
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'crear_cliente', tabla: 'cliente',
      registroId: r.rows[0].id, detalle: { nombre: r.rows[0].nombre } });
    return [201, r.rows[0]];
  });
});

// Bloquea o desbloquea. Para bloquear hace falta el motivo.
router.put('/:id/bloqueo', requierePermiso('clientes.editar'), async (req, res, next) => {
  const id = Number(req.params.id);
  const { bloqueado, motivo } = req.body || {};
  if (!esId(id) || typeof bloqueado !== 'boolean' || (bloqueado && !texto(motivo))) {
    return res.status(400).json({ error: 'Indica bloqueado (true/false) y, para bloquear, el motivo' });
  }
  await enTransaccion(res, next, async (client) => {
    const r = await client.query(
      `UPDATE cliente SET bloqueado = $2, motivo_bloqueo = $3 WHERE id = $1 RETURNING ${COLUMNAS}`,
      [id, bloqueado, bloqueado ? motivo.trim() : null]);
    if (!r.rows[0]) return [404, { error: 'Cliente no encontrado' }];
    await registrar(client, {
      usuarioId: req.usuario.id, accion: bloqueado ? 'bloquear_cliente' : 'desbloquear_cliente',
      tabla: 'cliente', registroId: id, detalle: { motivo: bloqueado ? motivo.trim() : null } });
    return [200, r.rows[0]];
  });
});

module.exports = router;
