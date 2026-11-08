const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin);

const texto = (x) => typeof x === 'string' && x.trim().length > 0;
// Campo opcional: puede faltar, venir null o ser un texto no vacio.
const opcional = (x) => x === undefined || x === null || texto(x);
const limpio = (x) => (texto(x) ? x.trim() : null);

// Lista: ?q=texto busca por nombre o NIT.
router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%';
    const r = await pool.query(
      `SELECT id, nombre, nit, telefono, correo, direccion, activo
         FROM proveedor
        WHERE nombre ILIKE $1 OR nit ILIKE $1
        ORDER BY nombre LIMIT 200`, [q]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post('/', requierePermiso('proveedores.gestionar'), async (req, res, next) => {
  const b = req.body || {};
  if (!texto(b.nombre) || !opcional(b.nit) || !opcional(b.telefono) ||
      !opcional(b.correo) || !opcional(b.direccion)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO proveedor (nombre, nit, telefono, correo, direccion)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, nit, telefono, correo, direccion, activo`,
      [b.nombre.trim(), limpio(b.nit), limpio(b.telefono), limpio(b.correo), limpio(b.direccion)]);
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'crear_proveedor', tabla: 'proveedor',
      registroId: r.rows[0].id, detalle: { nombre: r.rows[0].nombre } });
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
