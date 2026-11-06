const jwt = require('jsonwebtoken');
const pool = require('../db');

// El token solo dice QUIEN es (firma valida, maximo 8 horas). El rol y las sucursales
// vigentes salen de la base en cada peticion: si desactivan al usuario o le quitan una
// sucursal, el cambio aplica al instante y no cuando venza el token.
async function requiereLogin(req, res, next) {
  const cabecera = req.headers.authorization || '';
  const [tipo, token] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token) return res.status(401).json({ error: 'Falta el token' });
  let d;
  try {
    d = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido o vencido' });
  }
  try {
    const r = await pool.query(
      `SELECT c.nombre AS rol, c.nivel_poder AS nivel,
              COALESCE(array_agg(s.id::int ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL), '{}') AS sucursales
         FROM usuario u
         JOIN categoria_empleado c ON c.id = u.categoria_empleado_id
         LEFT JOIN sucursal_usuario su ON su.usuario_id = u.id
         LEFT JOIN sucursal s ON s.id = su.sucursal_id AND s.activo
        WHERE u.id = $1 AND u.activo AND c.activo
        GROUP BY c.nombre, c.nivel_poder`, [d.sub]);
    const u = r.rows[0];
    if (!u) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    req.usuario = { id: d.sub, rol: u.rol, nivel: u.nivel, sucursales: u.sucursales };
    next();
  } catch (e) { next(e); }
}

module.exports = { requiereLogin };
