const jwt = require('jsonwebtoken');

function requiereLogin(req, res, next) {
  const cabecera = req.headers.authorization || '';
  const [tipo, token] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token) return res.status(401).json({ error: 'Falta el token' });
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = { id: d.sub, rol: d.rol, nivel: d.nivel, sucursales: d.sucursales };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalido o vencido' });
  }
}

module.exports = { requiereLogin };
