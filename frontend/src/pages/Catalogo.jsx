import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const VACIO = { categoria_producto_id: '', codigo: '', nombre: '', medida: '', impuesto_porcentaje: '0',
                precio_venta: '', stock_minimo: '' };

export default function Catalogo() {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [catNueva, setCatNueva] = useState({ nombre: '', maneja_caducidad: false });

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    try {
      const [c, p] = await Promise.all([
        api('GET', '/catalogo/categorias'),
        api('GET', `/catalogo/productos?sucursal_id=${sucursal}&q=${encodeURIComponent(q)}`),
      ]);
      setCategorias(c); setProductos(p); setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal, q]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const campo = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function crear(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = {
      categoria_producto_id: Number(form.categoria_producto_id),
      codigo: form.codigo.trim(), nombre: form.nombre.trim(),
      impuesto_porcentaje: Number(form.impuesto_porcentaje),
    };
    if (form.medida.trim()) cuerpo.medida = form.medida.trim();
    const conPrecio = form.precio_venta !== '';
    if (form.stock_minimo !== '' && !conPrecio) {
      setError('Para fijar el stock mínimo indica también el precio de venta'); return;
    }
    try {
      const p = await api('POST', '/catalogo/productos', cuerpo);
      if (conPrecio) {
        const sc = { precio_venta: Number(form.precio_venta) };
        if (form.stock_minimo !== '') sc.stock_minimo = Number(form.stock_minimo);
        await api('PUT', '/catalogo/productos/' + p.id + '/sucursales/' + sucursal, sc);
      }
      setForm(VACIO);
      setAviso(conPrecio ? 'Producto creado y habilitado en esta sucursal'
        : 'Producto creado. Falta ponerle precio para poder comprarlo y venderlo.');
      cargar();
    } catch (err) { setError(err.message); }
  }

  async function guardarPrecio(p, texto) {
    const valor = Number(texto);
    if (texto === '' || Number.isNaN(valor) || valor < 0 || String(valor) === String(p.precio_venta)) return;
    try {
      await api('PUT', `/catalogo/productos/${p.id}/sucursales/${sucursal}`, { precio_venta: valor });
      setAviso(`Precio de ${p.nombre} guardado`); setError('');
      cargar();
    } catch (err) { setError(err.message); }
  }

  async function crearCategoria(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = { nombre: catNueva.nombre.trim() };
    if (catNueva.maneja_caducidad) cuerpo.maneja_caducidad = true;
    try {
      await api('POST', '/catalogo/categorias', cuerpo);
      setCatNueva({ nombre: '', maneja_caducidad: false }); setAviso('Categoría creada'); cargar();
    } catch (err) { setError(err.message); }
  }

  async function desactivarCategoria(c) {
    if (!window.confirm('¿Desactivar la categoría ' + c.nombre + '? Dejará de ofrecerse al crear productos.')) return;
    setError(''); setAviso('');
    try { await api('PUT', '/catalogo/categorias/' + c.id + '/activo', { activo: false }); setAviso('Categoría desactivada'); cargar(); }
    catch (err) { setError(err.message); }
  }

  async function guardarMinimo(p, texto) {
    const valor = Number(texto);
    if (texto === '' || Number.isNaN(valor) || valor < 0 || valor === Number(p.stock_minimo)) return;
    try {
      await api('PUT', '/catalogo/productos/' + p.id + '/sucursales/' + sucursal,
        { precio_venta: Number(p.precio_venta), stock_minimo: valor });
      setAviso('Stock mínimo de ' + p.nombre + ' guardado'); setError('');
      cargar();
    } catch (err) { setError(err.message); }
  }

  const nombreCat = Object.fromEntries(categorias.map((c) => [c.id, c.nombre]));

  return (
    <>
      <h2>Catálogo</h2>
      <form className="formulario" onSubmit={crearCategoria}>
        <input placeholder="Nueva categoría (ej. Aseo, Herramientas)" value={catNueva.nombre}
               onChange={(e) => setCatNueva({ ...catNueva, nombre: e.target.value })} required />
        <label className="check">
          <input type="checkbox" checked={catNueva.maneja_caducidad}
                 onChange={(e) => setCatNueva({ ...catNueva, maneja_caducidad: e.target.checked })} /> Maneja caducidad
        </label>
        <button className="secundario">Crear categoría</button>
        <div className="chips ancho">
          {categorias.map((c) => (
            <span key={c.id} className="etiqueta neutra">
              {c.nombre}{c.maneja_caducidad ? ' · caduca' : ''}
              <button type="button" className="x" title="Desactivar" onClick={() => desactivarCategoria(c)}>×</button>
            </span>
          ))}
        </div>
      </form>
      <form className="formulario" onSubmit={crear}>
        <select value={form.categoria_producto_id} onChange={campo('categoria_producto_id')} required>
          <option value="">Categoría…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input placeholder="Código" value={form.codigo} onChange={campo('codigo')} required />
        <input placeholder="Nombre" value={form.nombre} onChange={campo('nombre')} required />
        <input placeholder="Medida (ej. botella)" value={form.medida} onChange={campo('medida')} />
        <input type="number" min="0" max="100" step="any" title="IVA %" placeholder="IVA %"
               value={form.impuesto_porcentaje} onChange={campo('impuesto_porcentaje')} />
        <input type="number" min="0" step="any" placeholder="Precio de venta (sucursal elegida)"
               value={form.precio_venta} onChange={campo('precio_venta')} />
        <input type="number" min="0" step="any" placeholder="Stock mínimo"
               value={form.stock_minimo} onChange={campo('stock_minimo')} />
        <button>Crear producto</button>
      </form>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder="Buscar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Código</th><th>Producto</th><th>Categoría</th><th className="num">IVA</th>
                <th className="num">Precio en esta sucursal</th><th className="num">Stock mínimo</th></tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td>{p.codigo}</td>
                <td>{p.nombre}{p.medida ? <span className="suave"> · {p.medida}</span> : null}</td>
                <td>{nombreCat[p.categoria_producto_id] ?? ''}</td>
                <td className="num">{Number(p.impuesto_porcentaje)}%</td>
                <td className="num">
                  <input className="precio" type="number" min="0" step="any" placeholder="Sin precio"
                         key={`${p.id}-${p.precio_venta}`} defaultValue={p.precio_venta ?? ''}
                         onBlur={(e) => guardarPrecio(p, e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </td>
                <td className="num">
                  <input className="precio" type="number" min="0" step="any"
                         placeholder={p.precio_venta === null ? 'Primero el precio' : '0'}
                         disabled={p.precio_venta === null}
                         key={p.id + '-min-' + p.stock_minimo} defaultValue={p.stock_minimo ?? ''}
                         onBlur={(e) => guardarMinimo(p, e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan="6" className="vacio">Sin productos</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
