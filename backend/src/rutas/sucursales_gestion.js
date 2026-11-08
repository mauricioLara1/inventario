const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, enTransaccion } = require('../util');
const { reglas, leerCampos, actualizar, rutaActivo, reglaNegocio } = require('../edicion');

// Editar y activar/desactivar sucursales: solo owner (crear y listar estan en sucursales.js).
// Una sucursal inactiva deja de aparecer en el acceso de sus usuarios al instante.
const router = express.Router();
router.use(requiereLogin, requierePermiso('sucursales.gestionar'));

router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, { nombre: reglas.texto, direccion: reglas.textoONulo });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    const s = await actualizar(client, 'sucursal', id, l.valores, 'id, nombre, direccion, activo');
    if (!s) return [404, { error: 'Sucursal no encontrada' }];
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: id, accion: 'editar_sucursal', tabla: 'sucursal',
      registroId: id, detalle: { campos: Object.keys(l.valores) } });
    return [200, s];
  });
});

rutaActivo(router, {
  ruta: '/:id/activo', tabla: 'sucursal', retorno: 'id, nombre, direccion, activo',
  entidad: 'sucursal', etiqueta: 'Sucursal', conSucursal: true,
  verificar: async (client, id, activo) => {
    if (activo) return;
    const r = await client.query(
      "SELECT 1 FROM renta WHERE sucursal_id = $1 AND estado = 'abierta' LIMIT 1", [id]);
    if (r.rowCount > 0) throw reglaNegocio('No se puede desactivar: hay rentas abiertas en esa sucursal');
  },
});

module.exports = router;
