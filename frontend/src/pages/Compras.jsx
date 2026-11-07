import { useCallback, useEffect, useState } from 'react';
import { Link } from "react-router-dom";
import { api } from '../api';
import { pesos, fecha } from '../formato';

const CLASE = { borrador: 'neutra', recibida: 'buena', anulada: 'mala' };

export default function Compras() {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [proveedores, setProveedores] = useState([]);
  const [compras, setCompras] = useState([]);
  const [estado, setEstado] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [factura, setFactura] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    try {
      const [c, p] = await Promise.all([
        api('GET', `/compras?sucursal_id=${sucursal}${estado ? `&estado=${estado}` : ''}`),
        api('GET', '/proveedores'),
      ]);
      setCompras(c); setProveedores(p.filter((x) => x.activo)); setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal, estado]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function crearCompra(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = { sucursal_id: Number(sucursal), proveedor_id: Number(proveedor) };
    if (factura.trim()) cuerpo.numero_factura_proveedor = factura.trim();
    try {
      const c = await api('POST', '/compras', cuerpo);
      setFactura(''); setAviso(`Compra ${c.numero} creada en borrador`);
      cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Compras</h2>
      <p className="suave">¿Falta el proveedor? <Link to="/proveedores">Créalo aquí</Link></p>
      <form className="formulario" onSubmit={crearCompra}>
        <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} required>
          <option value="">Proveedor…</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <input placeholder="N.º factura del proveedor (opcional)" value={factura}
               onChange={(e) => setFactura(e.target.value)} />
        <button>Nueva compra</button>
      </form>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="recibida">Recibida</option>
          <option value="anulada">Anulada</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Estado</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id}>
                <td>{c.numero}</td><td>{fecha(c.fecha)}</td><td>{c.proveedor}</td>
                <td>{c.numero_factura_proveedor ?? '—'}</td>
                <td><span className={`etiqueta ${CLASE[c.estado] ?? 'neutra'}`}>{c.estado}</span></td>
                <td className="num">{pesos(c.total)}</td>
              </tr>
            ))}
            {compras.length === 0 && <tr><td colSpan="6" className="vacio">Sin compras</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
