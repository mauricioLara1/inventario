import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { pesos } from '../formato';

const ESTADO = { disponible: 'buena', rentada: 'neutra', mantenimiento: 'mala', retirada: 'neutra' };
const P_VACIO = { categoria_renta_id: '', codigo: '', nombre: '', formato_cobro_id: '', precio: '',
                  impuesto_porcentaje: '0', deposito: '', reposicion: '' };

export default function CatalogoRenta() {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [formatos, setFormatos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [catNueva, setCatNueva] = useState('');
  const [prod, setProd] = useState(P_VACIO);
  const [pieza, setPieza] = useState({ producto_renta_id: '', codigo: '' });
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
      'Categoría creada');
  };
  const crearProducto = (e) => {
    e.preventDefault();
    const cuerpo = {
      categoria_renta_id: Number(prod.categoria_renta_id), codigo: prod.codigo.trim(), nombre: prod.nombre.trim(),
      formato_cobro_id: Number(prod.formato_cobro_id), precio: Number(prod.precio),
      impuesto_porcentaje: Number(prod.impuesto_porcentaje || 0) };
    if (prod.deposito) cuerpo.deposito = Number(prod.deposito);
    if (prod.reposicion) cuerpo.reposicion = Number(prod.reposicion);
    hacer(async () => { await api('POST', '/renta-catalogo/productos', cuerpo); setProd(P_VACIO); }, 'Producto de renta creado');
  };
  const crearPieza = (e) => {
    e.preventDefault();
    hacer(async () => {
      await api('POST', '/renta-catalogo/unidades', {
        producto_renta_id: Number(pieza.producto_renta_id), sucursal_id: Number(sucursal), codigo: pieza.codigo.trim() });
      setPieza({ ...pieza, codigo: '' });
    }, 'Pieza creada');
  };
  const cambiarEstado = (u, estado) =>
    hacer(() => api('PUT', `/renta-catalogo/unidades/${u.id}/estado`, { estado }), `Pieza ${u.codigo}: ${estado}`);

  return (
    <>
      <h2>Catálogo de renta</h2>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <h3>Productos de renta</h3>
      <form className="formulario" onSubmit={crearCategoria}>
        <input placeholder="Nueva categoría (ej. Escaleras)" value={catNueva} onChange={(e) => setCatNueva(e.target.value)} required />
        <button className="secundario">Crear categoría</button>
      </form>
      <form className="formulario" onSubmit={crearProducto}>
        <select value={prod.categoria_renta_id} onChange={campo('categoria_renta_id')} required>
          <option value="">Categoría…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input placeholder="Código" value={prod.codigo} onChange={campo('codigo')} required />
        <input placeholder="Nombre" value={prod.nombre} onChange={campo('nombre')} required />
        <select value={prod.formato_cobro_id} onChange={campo('formato_cobro_id')} required>
          <option value="">Se cobra por…</option>
          {formatos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
        <input type="number" min="0" step="any" placeholder="Tarifa por periodo" value={prod.precio} onChange={campo('precio')} required />
        <input type="number" min="0" max="100" step="any" placeholder="IVA %" value={prod.impuesto_porcentaje} onChange={campo('impuesto_porcentaje')} />
        <input type="number" min="0" step="any" placeholder="Depósito" value={prod.deposito} onChange={campo('deposito')} />
        <input type="number" min="0" step="any" placeholder="Valor de reposición" value={prod.reposicion} onChange={campo('reposicion')} />
        <button>Crear producto de renta</button>
      </form>
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Cobro</th>
            <th className="num">Tarifa</th><th className="num">IVA</th><th className="num">Depósito</th><th className="num">Reposición</th></tr></thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td><td>{p.nombre}</td><td>{p.categoria}</td><td>por {p.formato}</td>
                <td className="num">{pesos(p.precio)}</td><td className="num">{Number(p.impuesto_porcentaje)}%</td>
                <td className="num">{pesos(p.deposito)}</td><td className="num">{pesos(p.reposicion)}</td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan="8" className="vacio">Sin productos de renta</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Piezas físicas</h3>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>
      <form className="formulario" onSubmit={crearPieza}>
        <select value={pieza.producto_renta_id} onChange={(e) => setPieza({ ...pieza, producto_renta_id: e.target.value })} required>
          <option value="">Producto…</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <input placeholder="Código de la pieza (ej. ESC-001)" value={pieza.codigo}
               onChange={(e) => setPieza({ ...pieza, codigo: e.target.value })} required />
        <button>Agregar pieza</button>
      </form>
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Código</th><th>Producto</th><th>Estado</th><th>Cambiar a</th></tr></thead>
          <tbody>
            {unidades.map((u) => (
              <tr key={u.id}>
                <td>{u.codigo}</td><td>{u.producto}</td>
                <td><span className={`etiqueta ${ESTADO[u.estado] ?? 'neutra'}`}>{u.estado}</span></td>
                <td>
                  {u.estado === 'rentada' ? <span className="suave">Se libera al devolverla</span> : (
                    <select value="" onChange={(e) => e.target.value && cambiarEstado(u, e.target.value)}>
                      <option value="">Elegir…</option>
                      {['disponible', 'mantenimiento', 'retirada'].filter((x) => x !== u.estado)
                        .map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {unidades.length === 0 && <tr><td colSpan="4" className="vacio">Sin piezas en esta sucursal</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
