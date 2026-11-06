const express = require('express');
const bcrypt = require('bcryptjs');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, texto, reglaNegocio, enTransaccion } = require('../util');

// Gestion de usuarios existentes (crear y listar estan en usuarios.js).
// Un admin solo gestiona usuarios de rol MENOR al suyo y que compartan una sucursal con el.
// El owner gestiona a todos, pero siempre debe quedar al menos un owner activo.
const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

// Usuario con su rol y todas sus sucursales.
async function detalle(db, id) {
  const r = await db.query(
    `SELECT u.id, u.nombre, u.usuario, c.nombre AS rol, c.nivel_poder AS nivel, u.activo,
            array_remove(array_agg(su.sucursal_id::int ORDER BY su.sucursal_id), NULL) AS sucursales
       FROM usuario u
       JOIN categoria_empleado c ON c.id = u.categoria_empleado_id
       LEFT JOIN sucursal_usuario su ON su.usuario_id = u.id
      WHERE u.id = $1 GROUP BY u.id, c.nombre, c.nivel_poder`, [id]);
  return r.rows[0] || null;
}

// El usuario si quien consulta puede gestionarlo; si no, null (se responde 404).
async function gestionable(db, req, id) {
  if (!esId(id)) return null;
  const t = await detalle(db, id);
  if (!t) return null;
  const yo = req.usuario;
  if (yo.nivel >= 100) return t;
  if (t.nivel >= yo.nivel) return null;
  return t.sucursales.some((s) => yo.sucursales.includes(s)) ? t : null;
}

async function hayOtroOwner(db, id) {
  const r = await db.query(
    `SELECT 1 FROM usuario u JOIN categoria_empleado c ON c.id = u.categoria_empleado_id
      WHERE c.nivel_poder >= 100 AND c.activo AND u.activo AND u.id <> $1 LIMIT 1`, [id]);
  return r.rowCount > 0;
}

// ---------- Editar nombre, rol y/o sucursales ----------
// Las sucursales se reemplazan: un admin solo reemplaza las suyas (no toca las demas del usuario).

router.put('/:id', async (req, res, next) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const campos = ['nombre', 'categoria_empleado_id', 'sucursales'].filter((k) => b[k] !== undefined);
  if (!esId(id) || campos.length === 0 ||
      (b.nombre !== undefined && !texto(b.nombre)) ||
      (b.categoria_empleado_id !== undefined && !esId(b.categoria_empleado_id)) ||
      (b.sucursales !== undefined && !(Array.isArray(b.sucursales) && b.sucursales.length > 0 &&
                                       b.sucursales.length <= 50 && b.sucursales.every(esId)))) {
    return res.status(400).json({
      error: 'Datos invalidos (al menos uno de: nombre, categoria_empleado_id, sucursales [lista de ids])' });
  }
  const yo = req.usuario;
  const esOwner = yo.nivel >= 100;
  const lista = b.sucursales ? [...new Set(b.sucursales)] : null;
  if (lista && !esOwner && !lista.every((s) => yo.sucursales.includes(s))) {
    return res.status(403).json({ error: 'No puedes asignar sucursales que no son tuyas' });
  }
  if (id === yo.id && (b.categoria_empleado_id !== undefined || lista)) {
    return res.status(422).json({ error: 'No puedes cambiar tu propio rol ni tus sucursales' });
  }
  await enTransaccion(res, next, async (client) => {
    const t = await gestionable(client, req, id);
    if (!t) return [404, { error: 'Usuario no encontrado' }];
    if (b.categoria_empleado_id !== undefined) {
      const c = await client.query(
        'SELECT nivel_poder FROM categoria_empleado WHERE id = $1 AND activo', [b.categoria_empleado_id]);
      if (!c.rows[0]) throw reglaNegocio('Categoria de empleado no existe');
      if (c.rows[0].nivel_poder > yo.nivel) {
        return [403, { error: 'No puedes asignar un rol con mas poder que el tuyo' }];
      }
      if (t.nivel >= 100 && c.rows[0].nivel_poder < 100 && !(await hayOtroOwner(client, id))) {
        throw reglaNegocio('Debe quedar al menos un owner activo');
      }
    }
    await client.query(
      `UPDATE usuario SET nombre = COALESCE($2, nombre),
                          categoria_empleado_id = COALESCE($3, categoria_empleado_id)
        WHERE id = $1`,
      [id, b.nombre ? b.nombre.trim() : null, b.categoria_empleado_id ?? null]);
    if (lista) {
      if (esOwner) {
        await client.query('DELETE FROM sucursal_usuario WHERE usuario_id = $1', [id]);
      } else {
        await client.query(
          'DELETE FROM sucursal_usuario WHERE usuario_id = $1 AND sucursal_id = ANY($2::bigint[])',
          [id, yo.sucursales]);
      }
      await client.query(
        `INSERT INTO sucursal_usuario (usuario_id, sucursal_id)
         SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [id, lista]);
    }
    await registrar(client, {
      usuarioId: yo.id, sucursalId: null, accion: 'editar_usuario', tabla: 'usuario', registroId: id,
      detalle: { usuario: t.usuario, campos } });
    return [200, await detalle(client, id)];
  });
});

// ---------- Activar / desactivar (al desactivar, su sesion deja de servir de inmediato) ----------

router.put('/:id/activo', async (req, res, next) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  if (!esId(id) || typeof b.activo !== 'boolean') {
    return res.status(400).json({ error: 'Datos invalidos (activo: true o false)' });
  }
  if (id === req.usuario.id) return res.status(422).json({ error: 'No puedes desactivarte a ti mismo' });
  await enTransaccion(res, next, async (client) => {
    const t = await gestionable(client, req, id);
    if (!t) return [404, { error: 'Usuario no encontrado' }];
    if (!b.activo && t.nivel >= 100 && !(await hayOtroOwner(client, id))) {
      throw reglaNegocio('Debe quedar al menos un owner activo');
    }
    await client.query('UPDATE usuario SET activo = $2 WHERE id = $1', [id, b.activo]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null,
      accion: b.activo ? 'activar_usuario' : 'desactivar_usuario',
      tabla: 'usuario', registroId: id, detalle: { usuario: t.usuario } });
    return [200, await detalle(client, id)];
  });
});

// ---------- Resetear la clave de otro usuario (la propia se cambia en /auth/cambiar-clave) ----------

router.put('/:id/clave', async (req, res, next) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  if (!esId(id) || typeof b.clave !== 'string') {
    return res.status(400).json({ error: 'Falta la clave' });
  }
  if (b.clave.length < 10) return res.status(400).json({ error: 'La clave debe tener minimo 10 caracteres' });
  if (id === req.usuario.id) {
    return res.status(422).json({ error: 'Tu propia clave se cambia en /auth/cambiar-clave' });
  }
  const hash = await bcrypt.hash(b.clave, 12);
  await enTransaccion(res, next, async (client) => {
    const t = await gestionable(client, req, id);
    if (!t) return [404, { error: 'Usuario no encontrado' }];
    await client.query('UPDATE usuario SET clave_hash = $2 WHERE id = $1', [id, hash]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'resetear_clave_usuario',
      tabla: 'usuario', registroId: id, detalle: { usuario: t.usuario } });
    return [200, { id, usuario: t.usuario, clave_cambiada: true }];
  });
});

module.exports = router;
