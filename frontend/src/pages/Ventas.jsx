import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { pesos, fecha } from '../formato';
import Buscador from '../Buscador';

const CLASE = { borrador: 'neutra', confirmada: 'buena', anulada: 'mala' };

export default function Ventas() {
  const navegar = useNavigate();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [cliente, setCliente] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    try {
      const [v] = await Promise.all([
        api('GET', `/ventas?sucursal_id=${sucursal}${estado ? `&estado=${estado}` : ''}`),
      ]);
      setVentas(v); setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal, estado]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const buscarClientes = (q) => api('GET', '/clientes?q=' + encodeURIComponent(q));

  async function crear(e) {
    e.preventDefault();
    setError('');
    const cuerpo = { sucursal_id: Number(sucursal) };
    if (cliente) cuerpo.cliente_id = Number(cliente.id);
    try {
      const v = await api('POST', '/ventas', cuerpo);
      navegar(`/ventas/${v.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Ventas</h2>
      <form className="formulario" onSubmit={crear}>
        <Buscador valor={cliente} onChange={setCliente}
                  buscar={buscarClientes}
                  placeholder="Cliente: nombre, documento o teléfono (vacío = consumidor final)"
                  titulo={(c) => c.nombre + (c.numero_documento ? ' · ' + c.numero_documento : '')}
                  detalle={(c) => (c.bloqueado ? 'Bloqueado' : c.telefono || 'Sin teléfono')}
                  exacto={(c, q) => c.numero_documento === q} />
        <button>Nueva venta</button>
      </form>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="confirmada">Confirmada</option>
          <option value="anulada">Anulada</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado</th>
                <th className="num">Total</th><th className="num">Saldo</th></tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id}>
                <td><Link to={`/ventas/${v.id}`}>{v.numero}</Link></td>
                <td>{fecha(v.fecha)}</td>
                <td>{v.cliente ?? 'Consumidor final'}</td>
                <td><span className={`etiqueta ${CLASE[v.estado] ?? 'neutra'}`}>{v.estado}</span></td>
                <td className="num">{pesos(v.total)}</td>
                <td className="num">{v.estado === 'confirmada' ? pesos(v.saldo) : '—'}</td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td colSpan="6" className="vacio">Sin ventas</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
