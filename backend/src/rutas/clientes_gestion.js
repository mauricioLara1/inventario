const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel, requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, enTransaccion } = require('../util');
const { reglas, leerCampos, actualizar, rutaActivo } = require('../edicion');

// Editar y activar/desactivar clientes (crear, listar y bloquear estan en clientes.js).
// El tipo y el numero de documento van juntos o ambos vacios: lo exige la base.
const router = express.Router();
router.use(requiereLogin, requierePermiso('clientes.editar'));

const RETORNO = 'id, nombre, tipo_documento, numero_documento, telefono, correo, bloqueado, activo';

router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, {
    nombre: reglas.texto, tipo_documento: reglas.textoONulo, numero_documento: reglas.textoONulo,
    telefono: reglas.textoONulo, correo: reglas.textoONulo });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    const c = await actualizar(client, 'cliente', id, l.valores, RETORNO);
    if (!c) return [404, { error: 'Cliente no encontrado' }];
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'editar_cliente', tabla: 'cliente', registroId: id,
      detalle: { nombre: c.nombre, campos: Object.keys(l.valores) } });
    return [200, c];
  });
});

rutaActivo(router, {
  ruta: '/:id/activo', tabla: 'cliente', retorno: RETORNO,
  entidad: 'cliente', etiqueta: 'Cliente',
});

module.exports = router;
