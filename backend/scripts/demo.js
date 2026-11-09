// Llena la base DEMO a través de la API real, así se cumplen todas las reglas del negocio.
// No se corre suelto: lo llama scripts/demo.sh (que pide la clave y recrea la base).
const path = require('node:path');
const { spawn } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

const u = new URL(process.env.DATABASE_URL);
u.pathname = '/inventario_demo';
const URL_DEMO = u.toString();
const PUERTO = 3200;
const BASE = `http://localhost:${PUERTO}`;
const CLAVE = process.env.DEMO_CLAVE;
if (!CLAVE || CLAVE.length < 10) { console.error('Falta DEMO_CLAVE'); process.exit(1); }

let token = null;
let fallos = 0;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const en = (horas) => new Date(Date.now() + horas * 3600000).toISOString();
const redondo = (x) => Math.round(x * 100) / 100;

async function llamar(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let json = null;
  try { json = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (!r.ok) throw new Error(`${r.status} ${json?.error ?? ''}`.trim());
  return json;
}
async function paso(nombre, fn) {
  try { const r = await fn(); console.log('  ✓', nombre); return r; }
  catch (e) { fallos++; console.log('  ✗', nombre, '→', e.message); return null; }
}

async function sembrar() {
  console.log('Sucursales');
  for (const [nombre, direccion] of [['Sede Centro', 'Calle 10 # 5-20'], ['Sede Norte', 'Av. 6N # 28-40']]) {
    await paso(nombre, () => llamar('POST', '/sucursales', { nombre, direccion }));
  }
  const sucs = await llamar('GET', '/sucursales');
  const s1 = Number(sucs.find((s) => s.nombre === 'Sede Centro')?.id);
  const s2 = Number(sucs.find((s) => s.nombre === 'Sede Norte')?.id);
  if (!s1 || !s2) throw new Error('No se pudieron crear las sucursales');

  console.log('Usuarios (todos con la clave que escribiste)');
  const roles = await llamar('GET', '/usuarios/roles');
  const rol = (n) => Number(roles.find((r) => r.nombre === n)?.id);
  for (const [nombre, usuario, r, sucursales] of [
    ['Gerente Demo', 'demo_gerente', 'gerente', [s1, s2]], ['Vendedor Demo', 'demo_vendedor', 'vendedor', [s1]],
    ['Bodega Demo', 'demo_bodega', 'bodega', [s1]], ['Mantenimiento Demo', 'demo_mant', 'mantenimiento', [s1]]]) {
    await paso(`${usuario} (${r})`, () => llamar('POST', '/usuarios',
      { nombre, usuario, clave: CLAVE, categoria_empleado_id: rol(r), sucursales }));
  }

  console.log('Catálogo');
  for (const [nombre, caduca] of [['Aseo', false], ['Alimentos', true], ['Ferretería', false]]) {
    await paso(`Categoría ${nombre}`, () => llamar('POST', '/catalogo/categorias', caduca ? { nombre, maneja_caducidad: true } : { nombre }));
  }
  const cats = await llamar('GET', '/catalogo/categorias');
  const cat = (n) => Number(cats.find((c) => c.nombre === n)?.id);
  const PRODUCTOS = [ // categoría, código, nombre, medida, IVA, precio, mínimo
    ['Aseo', 'JAB-001', 'Jabón líquido 1L', 'botella', 19, 12000, 10],
    ['Aseo', 'DET-001', 'Detergente 2kg', 'bolsa', 19, 18500, 8],
    ['Aseo', 'CLO-001', 'Cloro 1L', 'botella', 19, 6500, 12],
    ['Alimentos', 'ARR-001', 'Arroz 500g', 'bolsa', 0, 3200, 20],
    ['Alimentos', 'ACE-001', 'Aceite 1L', 'botella', 5, 14500, 6],
    ['Alimentos', 'LEC-001', 'Leche 1L', 'caja', 0, 4200, 15],
    ['Ferretería', 'MAR-001', 'Martillo', 'unidad', 19, 38000, 3],
    ['Ferretería', 'TOR-001', 'Tornillos x100', 'caja', 19, 9500, 10],
    ['Ferretería', 'PIN-001', 'Pintura blanca galón', 'galón', 19, 62000, 4],
  ];
  const prod = {};
  for (const [c, codigo, nombre, medida, iva, precio, minimo] of PRODUCTOS) {
    const p = await paso(`${codigo} ${nombre}`, () => llamar('POST', '/catalogo/productos',
      { categoria_producto_id: cat(c), codigo, nombre, medida, impuesto_porcentaje: iva }));
    if (!p) continue;
    prod[codigo] = { id: Number(p.id) };
    for (const [sid, factor] of [[s1, 1], [s2, 1.05]]) {
      await llamar('PUT', `/catalogo/productos/${p.id}/sucursales/${sid}`,
        { precio_venta: Math.round(precio * factor / 100) * 100, stock_minimo: minimo })
        .catch((e) => { fallos++; console.log('  ✗ precio de', codigo, '→', e.message); });
    }
  }

  console.log('Proveedores y clientes');
  for (const [nombre, nit, telefono] of [['Distribuidora El Sol', '900123456-1', '6025551010'],
    ['Alimentos del Valle', '900765432-2', '6025552020'], ['Ferretería Mayorista', '900555111-3', '6025553030']]) {
    await paso(`Proveedor ${nombre}`, () => llamar('POST', '/proveedores', { nombre, nit, telefono }));
  }
  const CLIENTES = [['Ana María Torres', 'CC', '1012345678', '3001112233'], ['Carlos Pérez', 'CC', '79876543', '3109998877'],
    ['Constructora Andes SAS', 'NIT', '900111222-4', '3205556677'], ['Lucía Fernández', 'CC', '52123456', '3154443322'],
    ['Pedro Gómez', 'CC', '80234567', null], ['Juan Morales', 'CC', '1098765432', '3017778899']];
  for (const [nombre, tipo, numero, telefono] of CLIENTES) {
    const cuerpo = { nombre, tipo_documento: tipo, numero_documento: numero };
    if (telefono) cuerpo.telefono = telefono;
    await paso(`Cliente ${nombre}`, () => llamar('POST', '/clientes', cuerpo));
  }
  const proveedores = await llamar('GET', '/proveedores');
  const prov = (n) => Number(proveedores.find((p) => p.nombre === n)?.id);
  const clientes = await llamar('GET', '/clientes');
  const cli = (n) => Number(clientes.find((c) => c.nombre === n)?.id);
  await paso('Juan Morales bloqueado', () => llamar('PUT', `/clientes/${cli('Juan Morales')}/bloqueo`, { bloqueado: true, motivo: 'Cartera vencida' }));

  console.log('Compras');
  async function comprar(nombre, suc, proveedor, factura, lineas, recibir = true) {
    await paso(nombre, async () => {
      const c = await llamar('POST', '/compras', { sucursal_id: suc, proveedor_id: prov(proveedor), numero_factura_proveedor: factura });
      for (const [codigo, cantidad, costo, caduca] of lineas) {
        const cuerpo = { producto_id: prod[codigo].id, cantidad, costo_unitario: costo };
        if (caduca) cuerpo.fecha_caducidad = caduca;
        await llamar('POST', `/compras/${c.id}/lineas`, cuerpo);
      }
      if (recibir) await llamar('POST', `/compras/${c.id}/recibir`);
    });
  }
  await comprar('Centro: aseo', s1, 'Distribuidora El Sol', 'FAC-1001', [['JAB-001', 40, 7000], ['DET-001', 25, 11000], ['CLO-001', 30, 3500]]);
  await comprar('Centro: alimentos', s1, 'Alimentos del Valle', 'FAC-2001', [['ARR-001', 60, 2100, dia(180)], ['ACE-001', 20, 10200, dia(120)], ['LEC-001', 30, 3100, dia(4)]]);
  await comprar('Centro: leche ya vencida (puede ser rechazada)', s1, 'Alimentos del Valle', 'FAC-2002', [['LEC-001', 10, 3000, dia(-2)]]);
  await comprar('Centro: ferretería', s1, 'Ferretería Mayorista', 'FAC-3001', [['MAR-001', 8, 22000], ['TOR-001', 40, 5200], ['PIN-001', 3, 41000]]);
  await comprar('Norte: aseo', s2, 'Distribuidora El Sol', 'FAC-1002', [['JAB-001', 15, 7200], ['CLO-001', 10, 3600]]);
  await comprar('Norte: alimentos', s2, 'Alimentos del Valle', 'FAC-2003', [['ARR-001', 30, 2100, dia(150)]]);
  await comprar('Norte: ferretería', s2, 'Ferretería Mayorista', 'FAC-3002', [['MAR-001', 2, 22500]]);
  await comprar('Centro: borrador sin recibir', s1, 'Ferretería Mayorista', 'FAC-3099', [['TOR-001', 10, 5300]], false);

  console.log('Ventas');
  async function vender(nombre, suc, cliente, lineas, { confirmar = true, pagar = 0, metodo = 'efectivo' } = {}) {
    return paso(nombre, async () => {
      const cuerpo = { sucursal_id: suc };
      if (cliente) cuerpo.cliente_id = cli(cliente);
      const v = await llamar('POST', '/ventas', cuerpo);
      for (const [codigo, cantidad, desc] of lineas) {
        const l = { producto_id: prod[codigo].id, cantidad };
        if (desc) l.descuento_porcentaje = desc;
        await llamar('POST', `/ventas/${v.id}/lineas`, l);
      }
      if (confirmar) {
        await llamar('POST', `/ventas/${v.id}/confirmar`);
        if (pagar > 0) {
          const det = await llamar('GET', `/ventas/${v.id}`);
          await llamar('POST', `/ventas/${v.id}/pagos`, { metodo, monto: pagar === 1 ? Number(det.saldo) : redondo(Number(det.saldo) * pagar) });
        }
      }
      return v.id;
    });
  }
  const v1 = await vender('Venta pagada completa (Ana)', s1, 'Ana María Torres', [['JAB-001', 3], ['DET-001', 2]], { pagar: 1 });
  await vender('Venta con deuda: pagó la mitad (Constructora)', s1, 'Constructora Andes SAS', [['MAR-001', 2], ['TOR-001', 10], ['PIN-001', 1]], { pagar: 0.5 });
  await vender('Venta consumidor final con tarjeta', s1, null, [['ARR-001', 5], ['ACE-001', 2], ['LEC-001', 6]], { pagar: 1, metodo: 'tarjeta' });
  await vender('Venta con descuento y deuda total (Carlos)', s1, 'Carlos Pérez', [['CLO-001', 4], ['JAB-001', 2, 10]]);
  await vender('Venta en borrador (Lucía)', s1, 'Lucía Fernández', [['ARR-001', 3]], { confirmar: false });
  await vender('Norte: venta consumidor final', s2, null, [['JAB-001', 2], ['ARR-001', 4]], { pagar: 1, metodo: 'tarjeta' });
  if (v1) {
    await paso('Nota crédito sobre la primera venta (con reingreso y reembolso)', async () => {
      const det = await llamar('GET', `/ventas/${v1}`);
      const linea = det.lineas.find((l) => l.codigo === 'DET-001');
      const n = await llamar('POST', '/notas-credito', { venta_id: Number(v1), motivo: 'Empaque dañado' });
      await llamar('POST', `/notas-credito/${n.id}/lineas`, { venta_detalle_id: Number(linea.id), cantidad: 1 });
      await llamar('POST', `/notas-credito/${n.id}/confirmar`);
      const nc = await llamar('GET', `/notas-credito/${n.id}`);
      await llamar('POST', `/notas-credito/${n.id}/reingresos`, { nota_credito_detalle_id: nc.lineas[0].id, cantidad: 1 });
      const v = await llamar('GET', `/ventas/${v1}`);
      if (Number(v.saldo) < 0) await llamar('POST', `/notas-credito/${n.id}/reembolsos`, { metodo: 'efectivo', monto: -Number(v.saldo) });
    });
  }

  console.log('Rentas');
  const formatos = await llamar('GET', '/renta-catalogo/formatos');
  const formato = formatos.find((f) => /d[ií]a/i.test(f.nombre)) ?? formatos[0];
  for (const n of ['Herramientas', 'Escaleras y andamios', 'Equipos de limpieza']) {
    await paso(`Categoría de renta ${n}`, () => llamar('POST', '/renta-catalogo/categorias', { nombre: n }));
  }
  const catsR = await llamar('GET', '/renta-catalogo/categorias');
  const catR = (n) => Number(catsR.find((c) => c.nombre === n)?.id);
  const prr = {};
  for (const [c, codigo, nombre, precio, deposito, reposicion] of [
    ['Herramientas', 'TAL', 'Taladro percutor', 25000, 80000, 350000],
    ['Escaleras y andamios', 'ESC', 'Escalera de tijera', 15000, 50000, 280000],
    ['Escaleras y andamios', 'AND', 'Andamio modular', 40000, 150000, 900000],
    ['Equipos de limpieza', 'HID', 'Hidrolavadora', 60000, 200000, 1200000]]) {
    const p = await paso(`${codigo} ${nombre}`, () => llamar('POST', '/renta-catalogo/productos',
      { categoria_renta_id: catR(c), codigo, nombre, formato_cobro_id: Number(formato.id), precio, impuesto_porcentaje: 19, deposito, reposicion }));
    if (p) prr[codigo] = Number(p.id);
  }
  for (const [suc, producto, pieza] of [
    [s1, 'TAL', 'TAL-001'], [s1, 'TAL', 'TAL-002'], [s1, 'TAL', 'TAL-003'],
    [s1, 'ESC', 'ESC-001'], [s1, 'ESC', 'ESC-002'], [s1, 'ESC', 'ESC-003'], [s1, 'ESC', 'ESC-004'],
    [s1, 'AND', 'AND-001'], [s1, 'AND', 'AND-002'], [s1, 'HID', 'HID-001'], [s1, 'HID', 'HID-002'],
    [s2, 'TAL', 'TAL-101'], [s2, 'ESC', 'ESC-101']]) {
    await llamar('POST', '/renta-catalogo/unidades', { producto_renta_id: prr[producto], sucursal_id: suc, codigo: pieza })
      .catch((e) => { fallos++; console.log('  ✗ pieza', pieza, '→', e.message); });
  }
  console.log('  ✓ piezas creadas');
  const piezasS1 = await llamar('GET', `/renta-catalogo/unidades?sucursal_id=${s1}`);
  await paso('ESC-004 en mantenimiento', () => llamar('PUT', `/renta-catalogo/unidades/${piezasS1.find((x) => x.codigo === 'ESC-004').id}/estado`, { estado: 'mantenimiento' }));

  async function abrirRenta(nombre, cliente, piezas, horas, deposito = 'efectivo') {
    return paso(nombre, async () => {
      const libres = await llamar('GET', `/renta-catalogo/unidades?sucursal_id=${s1}&estado=disponible`);
      const unidades = piezas.map((c) => Number(libres.find((x) => x.codigo === c).id));
      const r = await llamar('POST', '/rentas', { sucursal_id: s1, cliente_id: cli(cliente),
        fecha_prevista_devolucion: en(horas), unidades, deposito_metodo: deposito });
      return r.id;
    });
  }
  async function devolver(id, solo) {
    const r = await llamar('GET', `/rentas/${id}`);
    for (const l of r.lineas.filter((x) => !solo || x.unidad === solo)) {
      await llamar('POST', `/rentas/${id}/devolver`, { renta_detalle_id: l.id, estado: 'devuelta' });
    }
  }
  async function liquidar(id) {
    const r = await llamar('GET', `/rentas/${id}`);
    let saldo = redondo(Number(r.cuenta.saldo));
    let poder = redondo(Number(r.cuenta.deposito_en_poder));
    if (saldo > 0 && poder > 0) {
      const m = Math.min(saldo, poder);
      await llamar('POST', `/rentas/${id}/pagos`, { tipo: 'aplicacion_deposito', metodo: 'otro', monto: m });
      saldo = redondo(saldo - m); poder = redondo(poder - m);
    }
    if (saldo > 0) await llamar('POST', `/rentas/${id}/pagos`, { tipo: 'cobro', metodo: 'efectivo', monto: saldo });
    if (poder > 0) await llamar('POST', `/rentas/${id}/pagos`, { tipo: 'devolucion_deposito', metodo: 'efectivo', monto: poder });
    await llamar('POST', `/rentas/${id}/cerrar`);
  }
  await abrirRenta('Renta abierta (Ana): taladro y escalera', 'Ana María Torres', ['TAL-001', 'ESC-001'], 48);
  const r2 = await abrirRenta('Renta con devolución parcial (Constructora): 2 andamios', 'Constructora Andes SAS', ['AND-001', 'AND-002'], 72, 'transferencia');
  if (r2) await paso('  AND-001 devuelto, AND-002 sigue pendiente', () => devolver(r2, 'AND-001'));
  const r3 = await abrirRenta('Renta completa y cerrada (Lucía)', 'Lucía Fernández', ['ESC-002', 'TAL-002'], 24);
  if (r3) await paso('  devolución, liquidación y cierre', async () => { await devolver(r3); await liquidar(r3); });
  await abrirRenta('Renta con fecha vencida (Carlos) (puede ser rechazada)', 'Carlos Pérez', ['HID-001'], -2);
}

async function principal() {
  const servidor = spawn(process.execPath, ['src/index.js'], {
    cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(PUERTO), DATABASE_URL: URL_DEMO } });
  try {
    let listo = false;
    for (let i = 0; i < 50 && !listo; i++) {
      try { listo = (await fetch(`${BASE}/salud`)).ok; } catch (e) { /* aun no arranca */ }
      if (!listo) await dormir(200);
    }
    if (!listo) throw new Error('El servidor demo no arrancó');
    token = (await llamar('POST', '/auth/login', { usuario: 'demo_owner', clave: CLAVE })).token;
    await sembrar();
    console.log(`\nListo. ${fallos === 0 ? 'Sin errores.' : fallos + ' paso(s) con error (marcados con ✗ arriba); el resto quedó cargado.'}`);
    console.log('Usuarios: demo_owner, demo_gerente, demo_vendedor, demo_bodega, demo_mant (todos con la clave que escribiste).');
  } finally { servidor.kill(); }
}
principal().catch((e) => { console.error('Falló:', e.message); process.exit(1); });
