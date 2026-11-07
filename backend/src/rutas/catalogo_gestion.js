const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requiereNivel } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, enTransaccion } = require('../util');
const { reglas, leerCampos, actualizar, rutaActivo, reglaNegocio } = require('../edicion');

// Editar y activar/desactivar categorias y productos de venta (crear y listar estan en catalogo.js).
// El catalogo es global: lo edita un admin o el owner. El precio por sucursal se fija en catalogo.js.
const router = express.Router();
router.use(requiereLogin, requiereNivel(50));

// ---------- Categorias de producto ----------

router.put('/categorias/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, { nombre: reglas.texto, maneja_caducidad: reglas.bool });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    const c = await actualizar(client, 'categoria_producto', id, l.valores, 'id, nombre, maneja_caducidad, activo');
    if (!c) return [404, { error: 'Categoria no encontrada' }];
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'editar_categoria_producto', tabla: 'categoria_producto',
      registroId: id, detalle: { campos: Object.keys(l.valores) } });
    return [200, c];
  });
});

rutaActivo(router, {
  ruta: '/categorias/:id/activo', tabla: 'categoria_producto', retorno: 'id, nombre, maneja_caducidad, activo',
  entidad: 'categoria_producto', etiqueta: 'Categoria',
});

// ---------- Productos ----------
// Cambiar el impuesto o el nombre no altera lo ya vendido: las lineas guardan su propia copia.

router.put('/productos/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const l = leerCampos(req.body || {}, {
    categoria_producto_id: reglas.id, codigo: reglas.texto, codigo_barras: reglas.textoONulo,
    nombre: reglas.texto, medida: reglas.texto, impuesto_porcentaje: reglas.porcentaje,
    maneja_caducidad: reglas.bool });
  if (!esId(id) || l.error) return res.status(400).json({ error: l.error || 'id invalido' });
  await enTransaccion(res, next, async (client) => {
    if (l.valores.categoria_producto_id !== undefined) {
      const c = await client.query(
        'SELECT 1 FROM categoria_producto WHERE id = $1 AND activo', [l.valores.categoria_producto_id]);
      if (c.rowCount === 0) throw reglaNegocio('La categoria de producto no existe o esta inactiva');
    }
    if (l.valores.maneja_caducidad !== undefined) {
      const lotes = await client.query('SELECT 1 FROM lote WHERE producto_id = $1 LIMIT 1', [id]);
      if (lotes.rowCount > 0) throw reglaNegocio('El producto ya tiene lotes: no se cambia si maneja caducidad');
    }
    const p = await actualizar(client, 'producto', id, l.valores,
      'id, categoria_producto_id, codigo, codigo_barras, nombre, medida, impuesto_porcentaje, maneja_caducidad, activo');
    if (!p) return [404, { error: 'Producto no encontrado' }];
    await registrar(client, {
      usuarioId: req.usuario.id, accion: 'editar_producto', tabla: 'producto', registroId: id,
      detalle: { codigo: p.codigo, campos: Object.keys(l.valores) } });
    return [200, p];
  });
});

rutaActivo(router, {
  ruta: '/productos/:id/activo', tabla: 'producto',
  retorno: 'id, codigo, nombre, activo', entidad: 'producto', etiqueta: 'Producto',
});

module.exports = router;
