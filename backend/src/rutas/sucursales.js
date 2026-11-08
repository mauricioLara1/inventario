const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin);

// Lista: el owner (nivel 100) ve todas; los demas solo las asignadas.
router.get('/', async (req, res, next) => {
  try {
    const esOwner = req.usuario.nivel >= 100;
    const r = esOwner
      ? await pool.query('SELECT id, nombre, direccion, activo FROM sucursal ORDER BY nombre')
      : await pool.query('SELECT id, nombre, direccion, activo FROM sucursal WHERE id = ANY($1) ORDER BY nombre', [req.usuario.sucursales]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Crea una sucursal: solo owner.
router.post('/', requierePermiso('sucursales.gestionar'), async (req, res, next) => {
  const { nombre, direccion } = req.body || {};
  if (typeof nombre !== 'string' || !nombre.trim()) {
    return res.status(400).json({ error: 'Falta el nombre' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'INSERT INTO sucursal (nombre, direccion) VALUES ($1, $2) RETURNING id, nombre, direccion, activo',
      [nombre.trim(), typeof direccion === 'string' ? direccion.trim() : null]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: r.rows[0].id,
      accion: 'crear_sucursal', tabla: 'sucursal', registroId: r.rows[0].id,
      detalle: { nombre: r.rows[0].nombre } });
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
