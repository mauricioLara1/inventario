const { esId, texto, reglaNegocio, enTransaccion } = require('./util');
const { registrar } = require('./auditoria');

// Ayudante para las rutas PUT de edicion: valida solo los campos que llegan en el cuerpo
// y arma el UPDATE con ellos. Los nombres de tabla y de columna salen del codigo, nunca del cliente.

// Cada regla devuelve { valor } (ya limpio) o null si el dato es invalido.
const reglas = {
  id: (v) => (esId(v) ? { valor: v } : null),
  texto: (v) => (texto(v) ? { valor: v.trim() } : null),
  textoONulo: (v) => (v === null ? { valor: null } : texto(v) ? { valor: v.trim() } : null),
  bool: (v) => (typeof v === 'boolean' ? { valor: v } : null),
  porcentaje: (v) => (typeof v === 'number' && v >= 0 && v <= 100 ? { valor: v } : null),
  dinero: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e10 &&
    Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? { valor: v } : null),
};

// reglasPorCampo: { campo: regla }. Solo se toman los campos presentes en el cuerpo.
function leerCampos(cuerpo, reglasPorCampo) {
  const valores = {};
  for (const [campo, regla] of Object.entries(reglasPorCampo)) {
    if (cuerpo[campo] === undefined) continue;
    const r = regla(cuerpo[campo]);
    if (!r) return { error: `${campo} invalido` };
    valores[campo] = r.valor;
  }
  if (Object.keys(valores).length === 0) {
    return { error: `Nada que cambiar (campos permitidos: ${Object.keys(reglasPorCampo).join(', ')})` };
  }
  return { valores };
}

// UPDATE tabla SET col = $2, ... WHERE id = $1. Devuelve la fila o null si no existe.
async function actualizar(db, tabla, id, valores, retorno) {
  const cols = Object.keys(valores);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await db.query(
    `UPDATE ${tabla} SET ${sets} WHERE id = $1 RETURNING ${retorno}`,
    [id, ...cols.map((c) => valores[c])]);
  return r.rows[0] || null;
}

// PUT <ruta> con { activo: true|false }. verificar(client, id, activo) puede lanzar reglaNegocio.
function rutaActivo(router, { ruta, tabla, retorno, entidad, etiqueta, conSucursal, verificar }) {
  router.put(ruta, async (req, res, next) => {
    const id = Number(req.params.id);
    const activo = (req.body || {}).activo;
    if (!esId(id) || typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'Datos invalidos (activo: true o false)' });
    }
    await enTransaccion(res, next, async (client) => {
      const ex = await client.query(`SELECT id FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id]);
      if (!ex.rows[0]) return [404, { error: `${etiqueta} no encontrado` }];
      if (verificar) await verificar(client, id, activo);
      const r = await client.query(`UPDATE ${tabla} SET activo = $2 WHERE id = $1 RETURNING ${retorno}`, [id, activo]);
      await registrar(client, {
        usuarioId: req.usuario.id, sucursalId: conSucursal ? id : null,
        accion: `${activo ? 'activar' : 'desactivar'}_${entidad}`, tabla, registroId: id, detalle: {} });
      return [200, r.rows[0]];
    });
  });
}

module.exports = { reglas, leerCampos, actualizar, rutaActivo, reglaNegocio };
