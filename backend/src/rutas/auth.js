const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();
// Hash falso: se compara igual aunque el usuario no exista, para que no se note la diferencia por tiempo.
const HASH_FALSO = bcrypt.hashSync('no-existe', 12);

router.post('/login', async (req, res) => {
  const { usuario, clave } = req.body || {};
  if (typeof usuario !== 'string' || typeof clave !== 'string' || !usuario || !clave) {
    return res.status(400).json({ error: 'Faltan usuario y clave' });
  }
  try {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.clave_hash, c.nombre AS rol, c.nivel_poder
         FROM usuario u JOIN categoria_empleado c ON c.id = u.categoria_empleado_id
        WHERE lower(u.usuario) = lower($1) AND u.activo AND c.activo`, [usuario]);
    const u = r.rows[0];
    const ok = await bcrypt.compare(clave, u ? u.clave_hash : HASH_FALSO);
    if (!u || !ok) return res.status(401).json({ error: 'Credenciales invalidas' });

    const s = await pool.query(
      `SELECT s.id FROM sucursal_usuario su JOIN sucursal s ON s.id = su.sucursal_id
        WHERE su.usuario_id = $1 AND s.activo`, [u.id]);
    const sucursales = s.rows.map((x) => Number(x.id));

    const token = jwt.sign(
      { sub: Number(u.id), rol: u.rol, nivel: u.nivel_poder, sucursales },
      process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, usuario: { id: Number(u.id), nombre: u.nombre, rol: u.rol, sucursales } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
