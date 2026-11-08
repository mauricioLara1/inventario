const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');

// Roles que quien consulta puede asignar: los de nivel menor al suyo (el owner puede asignar todos).
const router = express.Router();
router.get('/roles', requiereLogin, requierePermiso('usuarios.gestionar'), async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, nombre, descripcion, nivel_poder FROM categoria_empleado
        WHERE activo AND (nivel_poder < $1 OR $1 >= 100) ORDER BY nivel_poder DESC`, [req.usuario.nivel]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

module.exports = router;
