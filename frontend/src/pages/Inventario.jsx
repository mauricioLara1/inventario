import { useEffect, useState } from 'react';
import { api } from '../api';

const num = (x) => Number(x).toLocaleString('es-CO', { maximumFractionDigits: 3 });
const pesos = (x) => (x === null || x === undefined ? '—'
  : Number(x).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));

export default function Inventario() {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [q, setQ] = useState('');
  const [bajo, setBajo] = useState(false);
  const [filas, setFilas] = useState([]);
  const [precios, setPrecios] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sucursal) return;
    const params = new URLSearchParams({ sucursal_id: sucursal, q, bajo });
    Promise.all([
      api('GET', `/inventario/stock?${params}`),
      api('GET', `/catalogo/productos?sucursal_id=${sucursal}`),
    ]).then(([f, p]) => {
      setFilas(f);
      setPrecios(Object.fromEntries(p.map((x) => [x.id, x.precio_venta])));
      setError('');
    }).catch((e) => setError(e.message));
  }, [sucursal, q, bajo]);

  return (
    <>
      <h2>Inventario</h2>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder="Buscar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> Solo stock bajo
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Código</th><th>Producto</th><th className="num">Disponible</th>
                <th className="num">Vencido</th><th className="num">Mínimo</th>
                <th className="num">Precio</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.producto_id}>
                <td>{f.codigo}</td>
                <td>{f.nombre}{f.medida ? <span className="suave"> · {f.medida}</span> : null}</td>
                <td className="num">{num(f.cantidad_vendible)}</td>
                <td className="num">{Number(f.cantidad_vencida) > 0 ? num(f.cantidad_vencida) : '—'}</td>
                <td className="num">{num(f.stock_minimo)}</td>
                <td className="num">{pesos(precios[f.producto_id])}</td>
                <td><span className={f.stock_bajo ? 'etiqueta mala' : 'etiqueta buena'}>
                  {f.stock_bajo ? 'Stock bajo' : 'OK'}</span></td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan="7" className="vacio">Sin productos</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
