const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');

const router = express.Router();
router.use(requiereLogin, requierePermiso('usuarios.gestionar'));

const esId = (x) => Number.isInteger(x) && x > 0;

// Lista: el owner ve todos; un admin solo ve usuarios de su nivel o menor que compartan alguna de sus sucursales.
router.get('/', async (req, res, next) => {
  try {
    const esOwner = req.usuario.nivel >= 100;
    const filtro = esOwner ? '' : `WHERE c.nivel_poder <= $1 AND EXISTS (
        SELECT 1 FROM sucursal_usuario x WHERE x.usuario_id = u.id AND x.sucursal_id = ANY($2))`;
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, c.nombre AS rol, u.activo,
              array_remove(array_agg(su.sucursal_id::int), NULL) AS sucursales
         FROM usuario u
         JOIN categoria_empleado c ON c.id = u.categoria_empleado_id
         LEFT JOIN sucursal_usuario su ON su.usuario_id = u.id
         ${filtro}
        GROUP BY u.id, c.nombre ORDER BY u.id`,
      esOwner ? [] : [req.usuario.nivel, req.usuario.sucursales]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

// Crea un usuario aplicando la regla de delegacion.
router.post('/', async (req, res, next) => {
  const { nombre, usuario, clave, categoria_empleado_id, sucursales } = req.body || {};
  if (typeof nombre !== 'string' || !nombre.trim() ||
      typeof usuario !== 'string' || !usuario.trim() ||
      typeof clave !== 'string' || !esId(categoria_empleado_id) ||
      !Array.isArray(sucursales) || sucursales.length === 0 || !sucursales.every(esId)) {
    return res.status(400).json({ error: 'Datos incompletos o invalidos' });
  }
  if (clave.length < 10) return res.status(400).json({ error: 'La clave debe tener minimo 10 caracteres' });

  const yo = req.usuario;
  const lista = [...new Set(sucursales)];
  if (yo.nivel < 100 && !lista.every((s) => yo.sucursales.includes(s))) {
    return res.status(403).json({ error: 'No puedes asignar sucursales que no son tuyas' });
  }

  const client = await pool.connect();
  try {
    const c = await client.query(
      'SELECT nombre, nivel_poder FROM categoria_empleado WHERE id = $1 AND activo', [categoria_empleado_id]);
    if (!c.rows[0]) return res.status(422).json({ error: 'Categoria de empleado no existe' });
    if (c.rows[0].nivel_poder > yo.nivel) {
      return res.status(403).json({ error: 'No puedes crear un usuario con mas poder que el tuyo' });
    }

    const hash = await bcrypt.hash(clave, 12);
    await client.query('BEGIN');
    const u = await client.query(
      `INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, usuario, activo`,
      [nombre.trim(), usuario.trim(), hash, categoria_empleado_id]);
    await client.query(
      'INSERT INTO sucursal_usuario (usuario_id, sucursal_id) SELECT $1, unnest($2::bigint[])',
      [u.rows[0].id, lista]);
    await registrar(client, {
      usuarioId: yo.id, accion: 'crear_usuario', tabla: 'usuario', registroId: u.rows[0].id,
      detalle: { usuario: u.rows[0].usuario, rol: c.rows[0].nombre, sucursales: lista } });
    await client.query('COMMIT');
    res.status(201).json({ ...u.rows[0], rol: c.rows[0].nombre, sucursales: lista });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
