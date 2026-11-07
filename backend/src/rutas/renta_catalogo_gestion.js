const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, enTransaccion } = require('../util');
const { reglas, leerCampos, actualizar, rutaActivo } = require('../edicion');

// Editar y activar/desactivar el catalogo de rentas (crear y listar estan en renta_catalogo.js).
// Cambiar tarifa, impuesto o deposito de un producto aplica solo a las rentas NUEVAS:
// cada linea de renta guarda su propia copia. Un producto inactivo no se puede rentar.
const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

// Edita una fila de un catalogo simple (nombre y descripcion opcional).
function rutaEditarSimple(ruta, tabla, accion) {
  router.put(ruta, async (req, res, next) => {
    const id = Number(req.params.id);
    const l = leerCampos(req.body || {}, { nombre: reglas.texto, descripcion: reglas.textoONulo });
    if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
    await enTransaccion(res, next, async (client) => {
      const x = await actualizar(client, tabla, id, l.valores, 'id, nombre, descripcion, activo');
      if (!x) return [404, { error: 'No encontrado' }];
      await registrar(client, {
        usuarioId: req.usuario.id, sucursalId: null, accion, tabla, registroId: id,
        detalle: { campos: Object.keys(l.valores) } });
      return [200, x];
    });
  });
}

// ---------- Categorias de renta ----------
rutaEditarSimple('/categorias/:id', 'categoria_renta', 'editar_categoria_renta');
rutaActivo(router, {
  ruta: '/categorias/:id/activo', tabla: 'categoria_renta', retorno: 'id, nombre, descripcion, activo',
  entidad: 'categoria_renta', etiqueta: 'Categoria',
});

// ---------- Conceptos de cargo ----------
rutaEditarSimple('/conceptos/:id', 'concepto_cargo_renta', 'editar_concepto_cargo_renta');
rutaActivo(router, {
  ruta: '/conceptos/:id/activo', tabla: 'concepto_cargo_renta', retorno: 'id, nombre, descripcion, activo',
  entidad: 'concepto_cargo_renta', etiqueta: 'Concepto',
});

// ---------- Productos de renta ----------

router.put('/productos/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, {
    categoria_renta_id: reglas.id, codigo: reglas.texto, nombre: reglas.texto,
    formato_cobro_id: reglas.id, precio: reglas.dinero, impuesto_porcentaje: reglas.porcentaje,
    deposito: reglas.dinero, reposicion: reglas.dinero });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    const p = await actualizar(client, 'producto_renta', id, l.valores,
      'id, categoria_renta_id, codigo, nombre, formato_cobro_id, precio, impuesto_porcentaje, deposito, reposicion, activo');
    if (!p) return [404, { error: 'Producto de renta no encontrado' }];
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'editar_producto_renta',
      tabla: 'producto_renta', registroId: id, detalle: { codigo: p.codigo, campos: Object.keys(l.valores) } });
    return [200, p];
  });
});

rutaActivo(router, {
  ruta: '/productos/:id/activo', tabla: 'producto_renta', retorno: 'id, codigo, nombre, activo',
  entidad: 'producto_renta', etiqueta: 'Producto de renta',
});

module.exports = router;
