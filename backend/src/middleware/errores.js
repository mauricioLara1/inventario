// Traduce los errores (de PostgreSQL y de Express) a respuestas HTTP claras.
const ES_PRODUCCION = process.env.NODE_ENV === 'production';

// Violaciones de restriccion (clase 23): el cliente recibe un texto amable, no el nombre interno.
const MENSAJES_23 = {
  '23505': 'Ya existe un registro con ese valor',
  '23503': 'Hace referencia a un registro que no existe o que esta en uso',
  '23514': 'Un valor no cumple las reglas del sistema',
  '23502': 'Falta un dato obligatorio',
};

function manejarErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  const codigo = err.code;

  // JSON mal escrito en el cuerpo de la peticion.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la peticion no es un JSON valido' });
  }

  // Reglas de inventario que la base marca con su propio codigo.
  if (codigo === 'INV01' || codigo === 'INV02') {
    return res.status(409).json({ error: err.message, codigo });
  }

  // Reglas de negocio (RAISE EXCEPTION de nuestros triggers): el mensaje ya esta escrito para personas.
  if (codigo === 'P0001') {
    return res.status(422).json({ error: err.message, codigo });
  }

  // Restricciones de la base (unico, FK, check, not null).
  if (codigo && codigo.startsWith('23')) {
    const cuerpo = { error: MENSAJES_23[codigo] || 'Dato invalido', codigo };
    if (!ES_PRODUCCION && err.constraint) cuerpo.restriccion = err.constraint; // ayuda al desarrollar
    return res.status(422).json(cuerpo);
  }

  // Datos con formato incorrecto (clase 22): fecha invalida, numero fuera de rango, texto no numerico...
  if (codigo && codigo.startsWith('22')) {
    return res.status(400).json({ error: 'Un dato tiene un formato invalido', codigo });
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
