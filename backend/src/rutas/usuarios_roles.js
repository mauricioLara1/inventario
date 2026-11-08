const express = require('express');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');

// Roles que quien consulta puede asignar: los de su mismo nivel o menor (el owner ve todos).
const router = express.Router();
router.get('/roles', requiereLogin, requiereNivel(50), async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, nombre, descripcion, nivel_poder FROM categoria_empleado
        WHERE activo AND nivel_poder <= $1 ORDER BY nivel_poder DESC`, [req.usuario.nivel]);
    res.json(r.rows);
  } catch (e) { next(e); }
});

module.exports = router;
