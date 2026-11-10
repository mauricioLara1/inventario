const express = require('express');
const { requiereLogin } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/errores');
const { registrar } = require('../auditoria');
const { esId, puedeSucursal, enTransaccion } = require('../util');

// Importacion masiva de productos (el navegador lee el CSV y manda las filas).
// simular=true (por defecto): solo valida y responde el reporte, no escribe nada.
// simular=false: si TODAS las filas son validas crea todo en una transaccion; si no, no crea nada.
const router = express.Router();
const MAX_FILAS = 5000;

router.post('/importar', requiereLogin, requierePermiso('catalogo.editar'), async (req, res, next) => {
  const b = req.body || {};
  const filas = b.filas;
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > MAX_FILAS) {
    return res.status(400).json({ error: `Envia entre 1 y ${MAX_FILAS} filas` });
  }
  const simular = b.simular !== false;
  const sucursalId = b.sucursal_id === undefined || b.sucursal_id === null ? null : Number(b.sucursal_id);
  if (sucursalId !== null && (!esId(sucursalId) || !puedeSucursal(req.usuario, sucursalId))) {
    return res.status(403).json({ error: 'Esa sucursal no es tuya' });
  }
  const traePrecios = filas.some((f) => f && (f.precio_venta != null || f.stock_minimo != null));
  if (traePrecios) {
    if (sucursalId === null) return res.status(400).json({ error: 'Para importar precios o minimos elige una sucursal' });
    if (!req.usuario.permisos.includes('precios.editar')) {
      return res.status(403).json({ error: 'No tienes permiso para fijar precios' });
    }
  }
  await enTransaccion(res, next, async (client) => {
    const cats = (await client.query('SELECT id, nombre, activo FROM categoria_producto')).rows;
    const catPor = new Map(cats.map((c) => [c.nombre.toLowerCase(), c]));
    const codigos = new Set((await client.query('SELECT upper(codigo) AS c FROM producto')).rows.map((r) => r.c));
    const barras = new Set((await client.query(
      'SELECT codigo_barras AS c FROM producto WHERE codigo_barras IS NOT NULL')).rows.map((r) => r.c));
    const vistosCod = new Set();
    const vistosBar = new Set();
    const nuevas = new Map(); // nombre en minusculas -> nombre como lo escribieron
    const norm = [];
    const reporte = filas.map((f, i) => {
      const x = f || {};
      const e = [];
      const s = (v) => (typeof v === 'string' ? v.trim() : '');
      const cat = s(x.categoria); const cod = s(x.codigo); const nom = s(x.nombre);
      const bar = s(x.codigo_barras) || null; const med = s(x.medida) || null;
      const numOk = (v, max) => v === null || v === undefined ||
        (typeof v === 'number' && Number.isFinite(v) && v >= 0 && (max === undefined || v <= max));
      if (!cat) e.push('Falta la categoria');
      if (!cod) e.push('Falta el codigo'); else if (cod.length > 60) e.push('El codigo pasa de 60 caracteres');
      if (!nom) e.push('Falta el nombre'); else if (nom.length > 180) e.push('El nombre pasa de 180 caracteres');
      if (bar && bar.length > 80) e.push('El codigo de barras pasa de 80 caracteres');
      if (med && med.length > 30) e.push('La unidad pasa de 30 caracteres');
      if (!numOk(x.impuesto_porcentaje, 100)) e.push('IVA invalido (debe estar entre 0 y 100)');
      if (!numOk(x.precio_venta)) e.push('Precio invalido');
      if (!numOk(x.stock_minimo)) e.push('Minimo invalido');
      if (x.stock_minimo != null && x.precio_venta == null) e.push('Para fijar el minimo hace falta el precio');
      if (x.maneja_caducidad != null && typeof x.maneja_caducidad !== 'boolean') e.push('Caduca debe ser si o no');
      const cdb = cat ? catPor.get(cat.toLowerCase()) : null;
      if (cdb && !cdb.activo) e.push('La categoria esta desactivada');
      if (cod) {
        const k = cod.toUpperCase();
        if (codigos.has(k)) e.push('Ese codigo ya existe en el catalogo');
        else if (vistosCod.has(k)) e.push('Codigo repetido en el archivo');
        vistosCod.add(k);
      }
      if (bar) {
        if (barras.has(bar)) e.push('Ese codigo de barras ya existe');
        else if (vistosBar.has(bar)) e.push('Codigo de barras repetido en el archivo');
        vistosBar.add(bar);
      }
      if (cat && !cdb && !nuevas.has(cat.toLowerCase())) nuevas.set(cat.toLowerCase(), cat);
      norm.push({ cat, cod, nom, bar, med, iva: x.impuesto_porcentaje ?? null, cad: x.maneja_caducidad ?? null,
                  precio: x.precio_venta ?? null, min: x.stock_minimo ?? null });
      return { fila: i + 1, codigo: cod, nombre: nom, categoria: cat, errores: e };
    });
    const conError = reporte.filter((r) => r.errores.length).length;
    const resumen = { total: filas.length, con_error: conError, correctas: filas.length - conError,
                      categorias_nuevas: [...nuevas.values()] };
    if (simular) return [200, { simulacion: true, resumen, filas: reporte }];
    if (conError > 0) return [422, { error: 'Hay filas con errores: no se importo nada', resumen, filas: reporte }];

    for (const [clave, nombre] of nuevas) {
      const c = await client.query('INSERT INTO categoria_producto (nombre) VALUES ($1) RETURNING id', [nombre]);
      catPor.set(clave, { id: c.rows[0].id, activo: true });
    }
    let primero = null;
    for (const n of norm) {
      const p = await client.query(
        `INSERT INTO producto (categoria_producto_id, codigo, codigo_barras, nombre, medida,
                              impuesto_porcentaje, maneja_caducidad)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'unidad'), COALESCE($6::numeric, 0),
                 COALESCE($7::boolean, (SELECT maneja_caducidad FROM categoria_producto WHERE id = $1)))
         RETURNING id`,
        [catPor.get(n.cat.toLowerCase()).id, n.cod, n.bar, n.nom, n.med, n.iva, n.cad]);
      primero = primero ?? p.rows[0].id;
      if (n.precio !== null) {
        await client.query(
          `INSERT INTO producto_sucursal (producto_id, sucursal_id, precio_venta, stock_minimo)
           VALUES ($1, $2, $3, COALESCE($4::numeric, 0))`, [p.rows[0].id, sucursalId, n.precio, n.min]);
      }
    }
    await registrar(client, { usuarioId: req.usuario.id, accion: 'importar_productos', tabla: 'producto',
      registroId: primero, detalle: { filas: norm.length, categorias_nuevas: nuevas.size } });
    return [201, { importados: norm.length, categorias_creadas: nuevas.size }];
  });
});

module.exports = router;
