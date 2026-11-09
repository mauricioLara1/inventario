import Campo from '../Campo';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useTranslation } from 'react-i18next';

const VACIO = { categoria_producto_id: '', codigo: '', nombre: '', medida: '', impuesto_porcentaje: '0',
                precio_venta: '', stock_minimo: '' };

export default function Catalogo() {
  const { t } = useTranslation();
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
      setError(t('catalogo.minimoSinPrecio')); return;
    }
    try {
      const p = await api('POST', '/catalogo/productos', cuerpo);
      if (conPrecio) {
        const sc = { precio_venta: Number(form.precio_venta) };
        if (form.stock_minimo !== '') sc.stock_minimo = Number(form.stock_minimo);
        await api('PUT', '/catalogo/productos/' + p.id + '/sucursales/' + sucursal, sc);
      }
      setForm(VACIO);
      setAviso(conPrecio ? t('catalogo.creadoHabilitado')
        : t('catalogo.creadoSinPrecio'));
      cargar();
    } catch (err) { setError(err.message); }
  }

  async function guardarPrecio(p, texto) {
    const valor = Number(texto);
    if (texto === '' || Number.isNaN(valor) || valor < 0 || String(valor) === String(p.precio_venta)) return;
    try {
      await api('PUT', `/catalogo/productos/${p.id}/sucursales/${sucursal}`, { precio_venta: valor });
      setAviso(t('catalogo.precioGuardado', { nombre: p.nombre })); setError('');
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
      setCatNueva({ nombre: '', maneja_caducidad: false }); setAviso(t('catalogo.categoriaCreada')); cargar();
    } catch (err) { setError(err.message); }
  }

  async function desactivarCategoria(c) {
    if (!window.confirm(t('catalogo.confirmCat', { nombre: c.nombre }))) return;
    setError(''); setAviso('');
    try { await api('PUT', '/catalogo/categorias/' + c.id + '/activo', { activo: false }); setAviso(t('catalogo.categoriaDesactivada')); cargar(); }
    catch (err) { setError(err.message); }
  }

  async function guardarMinimo(p, texto) {
    const valor = Number(texto);
    if (texto === '' || Number.isNaN(valor) || valor < 0 || valor === Number(p.stock_minimo)) return;
    try {
      await api('PUT', '/catalogo/productos/' + p.id + '/sucursales/' + sucursal,
        { precio_venta: Number(p.precio_venta), stock_minimo: valor });
      setAviso(t('catalogo.minimoGuardado', { nombre: p.nombre })); setError('');
      cargar();
    } catch (err) { setError(err.message); }
  }

  const nombreCat = Object.fromEntries(categorias.map((c) => [c.id, c.nombre]));

  return (
    <>
      <h2>{t('menu.catalogo')}</h2>
      <form className="formulario" onSubmit={crearCategoria}>
        <Campo etiqueta={t('catalogo.categoriaNombre')} ayuda={t('catalogo.ayudaCategoriaNombre')}>
          <input value={catNueva.nombre}
                 onChange={(e) => setCatNueva({ ...catNueva, nombre: e.target.value })} required />
        </Campo>
        <Campo etiqueta={t('catalogo.manejaCaducidad')} ayuda={t('catalogo.ayudaManejaCaducidad')}>
          <input type="checkbox" checked={catNueva.maneja_caducidad}
                 onChange={(e) => setCatNueva({ ...catNueva, maneja_caducidad: e.target.checked })} />
        </Campo>
        <button className="secundario">{t('catalogo.crearCategoria')}</button>
        <div className="chips ancho">
          {categorias.map((c) => (
            <span key={c.id} className="etiqueta neutra">
              {c.nombre}{c.maneja_caducidad ? ' · ' + t('catalogo.caduca') : ''}
              <button type="button" className="x" title={t('comun.desactivar')} onClick={() => desactivarCategoria(c)}>×</button>
            </span>
          ))}
        </div>
      </form>
      <form className="formulario" onSubmit={crear}>
        <Campo etiqueta={t('catalogo.categoria')} ayuda={t('catalogo.ayudaCategoria')}>
          <select value={form.categoria_producto_id} onChange={campo('categoria_producto_id')} required>
            <option value="">{t('catalogo.categoriaOpcion')}</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('catalogo.codigo')} ayuda={t('catalogo.ayudaCodigo')}><input value={form.codigo} onChange={campo('codigo')} required /></Campo>
        <Campo etiqueta={t('comun.nombre')} ayuda={t('catalogo.ayudaNombre')}><input value={form.nombre} onChange={campo('nombre')} required /></Campo>
        <Campo etiqueta={t('catalogo.medida')} ayuda={t('catalogo.ayudaMedida')}><input value={form.medida} onChange={campo('medida')} /></Campo>
        <Campo etiqueta={t('catalogo.iva')} ayuda={t('catalogo.ayudaIva')}><input type="number" min="0" max="100" step="any" value={form.impuesto_porcentaje} onChange={campo('impuesto_porcentaje')} /></Campo>
        <Campo etiqueta={t('catalogo.precioVenta')} ayuda={t('catalogo.ayudaPrecioVenta')}><input type="number" min="0" step="any" value={form.precio_venta} onChange={campo('precio_venta')} /></Campo>
        <Campo etiqueta={t('catalogo.stockMinimo')} ayuda={t('catalogo.ayudaStockMinimo')}><input type="number" min="0" step="any" value={form.stock_minimo} onChange={campo('stock_minimo')} /></Campo>
        <button>{t('catalogo.crearProducto')}</button>
      </form>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder={t('catalogo.buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('catalogo.codigo')}</th><th>{t('catalogo.producto')}</th><th>{t('catalogo.categoria')}</th><th className="num">{t('catalogo.ivaCol')}</th>
                <th className="num">{t('catalogo.precioSucursal')}</th><th className="num">{t('catalogo.stockMinimo')}</th></tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td>{p.codigo}</td>
                <td>{p.nombre}{p.medida ? <span className="suave"> · {p.medida}</span> : null}</td>
                <td>{nombreCat[p.categoria_producto_id] ?? ''}</td>
                <td className="num">{Number(p.impuesto_porcentaje)}%</td>
                <td className="num">
                  <input className="precio" type="number" min="0" step="any" placeholder={t('catalogo.sinPrecio')}
                         key={`${p.id}-${p.precio_venta}`} defaultValue={p.precio_venta ?? ''}
                         onBlur={(e) => guardarPrecio(p, e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </td>
                <td className="num">
                  <input className="precio" type="number" min="0" step="any"
                         placeholder={p.precio_venta === null ? t('catalogo.primeroPrecio') : '0'}
                         disabled={p.precio_venta === null}
                         key={p.id + '-min-' + p.stock_minimo} defaultValue={p.stock_minimo ?? ''}
                         onBlur={(e) => guardarMinimo(p, e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan="6" className="vacio">{t('catalogo.sinProductos')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
