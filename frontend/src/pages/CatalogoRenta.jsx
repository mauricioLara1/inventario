import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { pesos } from '../formato';
import Campo from '../Campo';
import { useTranslation } from 'react-i18next';

const ESTADO = { disponible: 'buena', rentada: 'neutra', mantenimiento: 'mala', retirada: 'neutra' };
const P_VACIO = { categoria_renta_id: '', codigo: '', nombre: '', formato_cobro_id: '', precio: '',
                  impuesto_porcentaje: '0', deposito: '', reposicion: '', piezas: '' };

export default function CatalogoRenta() {
  const { t } = useTranslation();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [formatos, setFormatos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [catNueva, setCatNueva] = useState('');
  const [prod, setProd] = useState(P_VACIO);
  const [pieza, setPieza] = useState({ producto_renta_id: '', codigo: '' });
  const [buscarPieza, setBuscarPieza] = useState('');
  const [estadoPieza, setEstadoPieza] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [c, f, p, u] = await Promise.all([
        api('GET', '/renta-catalogo/categorias'),
        api('GET', '/renta-catalogo/formatos'),
        api('GET', '/renta-catalogo/productos?activo=true'),
        api('GET', `/renta-catalogo/unidades${sucursal ? `?sucursal_id=${sucursal}` : ''}`),
      ]);
      setCategorias(c); setFormatos(f); setProductos(p); setUnidades(u); setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); if (mensaje) setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }

  const campo = (k) => (e) => setProd({ ...prod, [k]: e.target.value });

  const crearCategoria = (e) => {
    e.preventDefault();
    hacer(async () => { await api('POST', '/renta-catalogo/categorias', { nombre: catNueva.trim() }); setCatNueva(''); },
      t('catalogoRenta.categoriaCreada'));
  };
  const crearProducto = (e) => {
    e.preventDefault();
    const cuerpo = {
      categoria_renta_id: Number(prod.categoria_renta_id), codigo: prod.codigo.trim(), nombre: prod.nombre.trim(),
      formato_cobro_id: Number(prod.formato_cobro_id), precio: Number(prod.precio),
      impuesto_porcentaje: Number(prod.impuesto_porcentaje || 0) };
    if (prod.deposito) cuerpo.deposito = Number(prod.deposito);
    if (prod.reposicion) cuerpo.reposicion = Number(prod.reposicion);
    const n = Math.max(0, Math.min(100, Number(prod.piezas || 0)));
    const base = cuerpo.codigo;
    hacer(async () => {
      const creado = await api('POST', '/renta-catalogo/productos', cuerpo);
      for (let i = 1; i <= n; i++) {
        await api('POST', '/renta-catalogo/unidades', {
          producto_renta_id: Number(creado.id), sucursal_id: Number(sucursal),
          codigo: base + '-' + String(i).padStart(3, '0') });
      }
      setProd(P_VACIO);
    }, n > 0 ? t('catalogoRenta.productoConPiezas', { n }) : t('catalogoRenta.productoCreado'));
  };
  const crearPieza = (e) => {
    e.preventDefault();
    hacer(async () => {
      await api('POST', '/renta-catalogo/unidades', {
        producto_renta_id: Number(pieza.producto_renta_id), sucursal_id: Number(sucursal), codigo: pieza.codigo.trim() });
      setPieza({ ...pieza, codigo: '' });
    }, t('catalogoRenta.piezaCreada'));
  };
  const cambiarEstado = (u, estado) =>
    hacer(() => api('PUT', `/renta-catalogo/unidades/${u.id}/estado`, { estado }), t('catalogoRenta.piezaEstado', { codigo: u.codigo, estado: t('estadosPieza.' + estado, { defaultValue: estado }) }));

  const tp = buscarPieza.trim().toLowerCase();
  const unidadesVista = unidades
    .filter((u) => !estadoPieza || u.estado === estadoPieza)
    .filter((u) => !tp || [u.codigo, u.producto, u.producto_codigo].some((x) => String(x).toLowerCase().includes(tp)));

  return (
    <>
      <h2>{t('menu.catalogo-renta')}</h2>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <h3>{t('catalogoRenta.productos')}</h3>
      <form className="formulario" onSubmit={crearCategoria}>
        <input placeholder={t('catalogoRenta.nuevaCategoria')} value={catNueva} onChange={(e) => setCatNueva(e.target.value)} required />
        <button className="secundario">{t('catalogoRenta.crearCategoria')}</button>
      </form>
      <form className="formulario" onSubmit={crearProducto}>
        <Campo etiqueta={t('catalogoRenta.categoria')} ayuda={t('catalogoRenta.ayudaCategoria')}>
          <select value={prod.categoria_renta_id} onChange={campo('categoria_renta_id')} required>
            <option value="">{t('catalogoRenta.elegir')}</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('catalogoRenta.codigo')} ayuda={t('catalogoRenta.ayudaCodigo')}>
          <input placeholder={t('catalogoRenta.ejCodigo')} value={prod.codigo} onChange={campo('codigo')} required />
        </Campo>
        <Campo etiqueta={t('comun.nombre')}>
          <input placeholder={t('catalogoRenta.ejNombre')} value={prod.nombre} onChange={campo('nombre')} required />
        </Campo>
        <Campo etiqueta={t('catalogoRenta.seCobraPor')} ayuda={t('catalogoRenta.ayudaSeCobraPor')}>
          <select value={prod.formato_cobro_id} onChange={campo('formato_cobro_id')} required>
            <option value="">{t('catalogoRenta.elegir')}</option>
            {formatos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('catalogoRenta.tarifaPeriodo')} ayuda={t('catalogoRenta.ayudaTarifa')}>
          <input type="number" min="0" step="any" placeholder={t('catalogoRenta.ejTarifa')} value={prod.precio} onChange={campo('precio')} required />
        </Campo>
        <Campo etiqueta={t('catalogoRenta.iva')} ayuda={t('catalogoRenta.ayudaIva')}>
          <input type="number" min="0" max="100" step="any" placeholder="0" value={prod.impuesto_porcentaje} onChange={campo('impuesto_porcentaje')} />
        </Campo>
        <Campo etiqueta={t('catalogoRenta.deposito')} ayuda={t('catalogoRenta.ayudaDeposito')}>
          <input type="number" min="0" step="any" placeholder={t('catalogoRenta.ejDeposito')} value={prod.deposito} onChange={campo('deposito')} />
        </Campo>
        <Campo etiqueta={t('catalogoRenta.reposicion')} ayuda={t('catalogoRenta.ayudaReposicion')}>
          <input type="number" min="0" step="any" placeholder={t('catalogoRenta.ejReposicion')} value={prod.reposicion} onChange={campo('reposicion')} />
        </Campo>
        <Campo etiqueta={t('catalogoRenta.piezasCrear')} ayuda={t('catalogoRenta.ayudaPiezas')}>
          <input type="number" min="0" max="100" step="1" placeholder={t('catalogoRenta.ejPiezas')} value={prod.piezas} onChange={campo('piezas')} />
        </Campo>
        <button>{t('catalogoRenta.crearProducto')}</button>
      </form>
      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('catalogoRenta.thCodigo')}</th><th>{t('catalogoRenta.thProducto')}</th><th>{t('catalogoRenta.categoria')}</th><th>{t('catalogoRenta.thCobro')}</th>
            <th className="num">{t('catalogoRenta.thTarifa')}</th><th className="num">{t('catalogoRenta.thIva')}</th><th className="num">{t('catalogoRenta.deposito')}</th><th className="num">{t('catalogoRenta.thReposicion')}</th></tr></thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td><td>{p.nombre}</td><td>{p.categoria}</td><td>{t('catalogoRenta.por')} {p.formato}</td>
                <td className="num">{pesos(p.precio)}</td><td className="num">{Number(p.impuesto_porcentaje)}%</td>
                <td className="num">{pesos(p.deposito)}</td><td className="num">{pesos(p.reposicion)}</td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan="8" className="vacio">{t('catalogoRenta.sinProductos')}</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>{t('catalogoRenta.piezasFisicas')}</h3>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder={t('catalogoRenta.buscarPieza')} value={buscarPieza}
               onChange={(e) => setBuscarPieza(e.target.value)} />
        <select value={estadoPieza} onChange={(e) => setEstadoPieza(e.target.value)}>
          <option value="">{t('comun.todosEstados')}</option>
          <option value="disponible">{t('catalogoRenta.disponibles')}</option>
          <option value="rentada">{t('catalogoRenta.rentadas')}</option>
          <option value="mantenimiento">{t('catalogoRenta.enMantenimiento')}</option>
          <option value="retirada">{t('catalogoRenta.retiradas')}</option>
        </select>
      </div>
      <p className="suave">{t('catalogoRenta.nDePiezas', { n: unidadesVista.length, total: unidades.length })}</p>
      <form className="formulario" onSubmit={crearPieza}>
        <select value={pieza.producto_renta_id} onChange={(e) => setPieza({ ...pieza, producto_renta_id: e.target.value })} required>
          <option value="">{t('catalogoRenta.productoOpcion')}</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <input placeholder={t('catalogoRenta.codigoPieza')} value={pieza.codigo}
               onChange={(e) => setPieza({ ...pieza, codigo: e.target.value })} required />
        <button>{t('catalogoRenta.agregarPieza')}</button>
      </form>
      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('catalogoRenta.thCodigo')}</th><th>{t('catalogoRenta.thProducto')}</th><th>{t('comun.estado')}</th><th>{t('catalogoRenta.cambiarA')}</th></tr></thead>
          <tbody>
            {unidadesVista.map((u) => (
              <tr key={u.id}>
                <td>{u.codigo}</td><td>{u.producto}</td>
                <td><span className={`etiqueta ${ESTADO[u.estado] ?? 'neutra'}`}>{t('estadosPieza.' + u.estado, { defaultValue: u.estado })}</span></td>
                <td>
                  {u.estado === 'rentada' ? <span className="suave">{t('catalogoRenta.seLibera')}</span> : (
                    <select value="" onChange={(e) => e.target.value && cambiarEstado(u, e.target.value)}>
                      <option value="">{t('catalogoRenta.elegir')}</option>
                      {['disponible', 'mantenimiento', 'retirada'].filter((x) => x !== u.estado)
                        .map((x) => <option key={x} value={x}>{t('estadosPieza.' + x)}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {unidadesVista.length === 0 && <tr><td colSpan="4" className="vacio">{unidades.length === 0 ? t('catalogoRenta.sinPiezas') : t('catalogoRenta.ningunaCoincide')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
