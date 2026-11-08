import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { pesos, fechaHora } from '../formato';

const CLASE = { abierta: 'neutra', cerrada: 'buena', cancelada: 'mala' };
const FORM = { cliente_id: '', fecha: '', metodo: 'efectivo', exonerar: false };

export default function Rentas() {
  const navegar = useNavigate();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [rentas, setRentas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [disponibles, setDisponibles] = useState([]);
  const [depositoDe, setDepositoDe] = useState({});
  const [estado, setEstado] = useState('');
  const [form, setForm] = useState(FORM);
  const [elegidas, setElegidas] = useState([]);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    try {
      const [r, c, u, p] = await Promise.all([
        api('GET', `/rentas?sucursal_id=${sucursal}${estado ? `&estado=${estado}` : ''}`),
        api('GET', '/clientes'),
        api('GET', `/renta-catalogo/unidades?sucursal_id=${sucursal}&estado=disponible`),
        api('GET', '/renta-catalogo/productos?activo=true'),
      ]);
      setRentas(r); setClientes(c); setDisponibles(u);
      setDepositoDe(Object.fromEntries(p.map((x) => [x.id, Number(x.deposito)])));
      setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal, estado]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreCliente = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));
  const deposito = disponibles.filter((u) => elegidas.includes(u.id))
    .reduce((t, u) => t + (depositoDe[u.producto_renta_id] ?? 0), 0);
  const alternar = (id) => setElegidas(elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]);

  async function abrir(e) {
    e.preventDefault();
    setError('');
    if (elegidas.length === 0) { setError('Elige al menos una pieza'); return; }
    const cuerpo = {
      sucursal_id: Number(sucursal), cliente_id: Number(form.cliente_id),
      fecha_prevista_devolucion: new Date(form.fecha).toISOString(), unidades: elegidas };
    if (form.exonerar) cuerpo.exonerar_deposito = true; else cuerpo.deposito_metodo = form.metodo;
    try {
      const r = await api('POST', '/rentas', cuerpo);
      navegar(`/rentas/${r.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Rentas</h2>
      <form className="formulario" onSubmit={abrir}>
        <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} required>
          <option value="">Cliente…</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.telefono || c.bloqueado}>
              {c.nombre}{!c.telefono ? ' (sin teléfono: no puede rentar)' : ''}{c.bloqueado ? ' (bloqueado)' : ''}
            </option>
          ))}
        </select>
        <label className="campo">Devolución prevista
          <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
        </label>
        <div className="piezas ancho">
          <strong>Piezas disponibles</strong>
          {disponibles.length === 0 && <span className="suave"> No hay piezas disponibles en esta sucursal.</span>}
          <div className="chips">
            {disponibles.map((u) => (
              <label key={u.id} className={`pieza ${elegidas.includes(u.id) ? 'elegida' : ''}`}>
                <input type="checkbox" checked={elegidas.includes(u.id)} onChange={() => alternar(u.id)} />
                {u.codigo} · {u.producto}
              </label>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.exonerar} onChange={(e) => setForm({ ...form, exonerar: e.target.checked })} />
          Exonerar depósito
        </label>
        {!form.exonerar && (
          <select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
            <option value="efectivo">Depósito en efectivo</option>
            <option value="transferencia">Depósito por transferencia</option>
            <option value="tarjeta">Depósito con tarjeta</option>
            <option value="otro">Depósito otro</option>
          </select>
        )}
        <button>Abrir renta {elegidas.length > 0 && !form.exonerar ? `· depósito ${pesos(deposito)}` : ''}</button>
      </form>

      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="abierta">Abiertas</option>
          <option value="cerrada">Cerradas</option>
          <option value="cancelada">Canceladas</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Número</th><th>Cliente</th><th>Inicio</th><th>Devolución prevista</th><th>Estado</th>
                <th className="num">Consumo</th><th className="num">Depósito</th><th className="num">Saldo</th></tr>
          </thead>
          <tbody>
            {rentas.map((r) => {
              const vencida = r.estado === 'abierta' && new Date(r.fecha_prevista_devolucion) < new Date();
              return (
                <tr key={r.id}>
                  <td><Link to={`/rentas/${r.id}`}>{r.numero}</Link></td>
                  <td>{nombreCliente[r.cliente_id] ?? `Cliente ${r.cliente_id}`}</td>
                  <td>{fechaHora(r.fecha_inicio)}</td>
                  <td>{fechaHora(r.fecha_prevista_devolucion)}</td>
                  <td>
                    <span className={`etiqueta ${CLASE[r.estado] ?? 'neutra'}`}>{r.estado}</span>
                    {vencida && <span className="etiqueta mala"> vencida</span>}
                  </td>
                  <td className="num">{pesos(r.consumo)}</td>
                  <td className="num">{pesos(r.deposito_en_poder)}</td>
                  <td className="num">{pesos(r.saldo)}</td>
                </tr>
              );
            })}
            {rentas.length === 0 && <tr><td colSpan="8" className="vacio">Sin rentas</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
