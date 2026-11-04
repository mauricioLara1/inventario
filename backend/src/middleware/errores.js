// Traduce los errores de PostgreSQL a respuestas HTTP claras.
function manejarErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  const codigo = err.code;
  if (codigo === 'INV01' || codigo === 'INV02') {
    return res.status(409).json({ error: err.message, codigo });
  }
  // 23xxx = violacion de restriccion (unico, FK, check...), P0001 = RAISE de nuestros triggers
  if (codigo === 'P0001' || (codigo && codigo.startsWith('23'))) {
    return res.status(422).json({ error: err.message, codigo });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
}

// Permite el paso solo si el nivel de poder del usuario es suficiente.
function requiereNivel(minimo) {
  return (req, res, next) => {
    if (!req.usuario || req.usuario.nivel < minimo) {
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }
    next();
  };
}

module.exports = { manejarErrores, requiereNivel };
