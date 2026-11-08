import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { pesos } from '../formato';
import Campo from '../Campo';

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

  const tp = buscarPieza.trim().toLowerCase();
  const unidadesVista = unidades
    .filter((u) => !estadoPieza || u.estado === estadoPieza)
    .filter((u) => !tp || [u.codigo, u.producto, u.producto_codigo].some((x) => String(x).toLowerCase().includes(tp)));

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
        <Campo etiqueta="Categoría" ayuda="Grupo al que pertenece (ej. Escaleras, Herramientas). Si no existe, créala en el formulario de arriba.">
          <select value={prod.categoria_renta_id} onChange={campo('categoria_renta_id')} required>
            <option value="">Elegir…</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Código" ayuda="Identificador corto y único del producto (ej. TAL). Las piezas se numeran a partir de él: TAL-001, TAL-002…">
          <input placeholder="Ej. TAL" value={prod.codigo} onChange={campo('codigo')} required />
        </Campo>
        <Campo etiqueta="Nombre">
          <input placeholder="Ej. Taladro percutor" value={prod.nombre} onChange={campo('nombre')} required />
        </Campo>
        <Campo etiqueta="Se cobra por" ayuda="Unidad de tiempo de la tarifa (hora, día…). La renta se cobra por periodos completos.">
          <select value={prod.formato_cobro_id} onChange={campo('formato_cobro_id')} required>
            <option value="">Elegir…</option>
            {formatos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Tarifa por periodo" ayuda="Lo que cuesta cada periodo (hora, día…) por pieza, sin IVA.">
          <input type="number" min="0" step="any" placeholder="Ej. 20000" value={prod.precio} onChange={campo('precio')} required />
        </Campo>
        <Campo etiqueta="IVA %" ayuda="Porcentaje de impuesto que se suma a la tarifa. Pon 0 si no aplica.">
          <input type="number" min="0" max="100" step="any" placeholder="0" value={prod.impuesto_porcentaje} onChange={campo('impuesto_porcentaje')} />
        </Campo>
        <Campo etiqueta="Depósito" ayuda="Dinero de garantía que el cliente deja por cada pieza. Se le devuelve cuando regresa la pieza, o se descuenta de lo que deba.">
          <input type="number" min="0" step="any" placeholder="Ej. 50000" value={prod.deposito} onChange={campo('deposito')} />
        </Campo>
        <Campo etiqueta="Valor de reposición" ayuda="Lo que cuesta reponer una pieza si se pierde. Queda registrado como referencia.">
          <input type="number" min="0" step="any" placeholder="Ej. 300000" value={prod.reposicion} onChange={campo('reposicion')} />
        </Campo>
        <Campo etiqueta="Piezas a crear" ayuda="Cuántas piezas físicas crear ahora en la sucursal elegida, con códigos automáticos (TAL-001, TAL-002…). Puedes dejarlo vacío y agregarlas después.">
          <input type="number" min="0" max="100" step="1" placeholder="Ej. 3" value={prod.piezas} onChange={campo('piezas')} />
        </Campo>
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
        <input placeholder="Buscar pieza por código o nombre" value={buscarPieza}
               onChange={(e) => setBuscarPieza(e.target.value)} />
        <select value={estadoPieza} onChange={(e) => setEstadoPieza(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="disponible">Disponibles</option>
          <option value="rentada">Rentadas</option>
          <option value="mantenimiento">En mantenimiento</option>
          <option value="retirada">Retiradas</option>
        </select>
      </div>
      <p className="suave">{unidadesVista.length} de {unidades.length} piezas</p>
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
            {unidadesVista.map((u) => (
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
            {unidadesVista.length === 0 && <tr><td colSpan="4" className="vacio">{unidades.length === 0 ? 'Sin piezas en esta sucursal' : 'Ninguna pieza coincide con el filtro'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
