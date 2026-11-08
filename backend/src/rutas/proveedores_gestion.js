const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, enTransaccion } = require('../util');
const { reglas, leerCampos, actualizar, rutaActivo } = require('../edicion');

// Editar y activar/desactivar proveedores (crear y listar estan en proveedores.js).
// Un proveedor inactivo no aparece al crear compras, pero sus compras anteriores se conservan.
const router = express.Router();
router.use(requiereLogin, requierePermiso('proveedores.gestionar'));

const RETORNO = 'id, nombre, nit, telefono, correo, direccion, activo';

router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, {
    nombre: reglas.texto, nit: reglas.textoONulo, telefono: reglas.textoONulo,
    correo: reglas.textoONulo, direccion: reglas.textoONulo });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    const p = await actualizar(client, 'proveedor', id, l.valores, RETORNO);
    if (!p) return [404, { error: 'Proveedor no encontrado' }];
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'editar_proveedor', tabla: 'proveedor', registroId: id,
      detalle: { nombre: p.nombre, campos: Object.keys(l.valores) } });
    return [200, p];
  });
});

rutaActivo(router, {
  ruta: '/:id/activo', tabla: 'proveedor', retorno: RETORNO,
  entidad: 'proveedor', etiqueta: 'Proveedor',
});

module.exports = router;
