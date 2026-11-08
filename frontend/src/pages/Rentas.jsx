import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { pesos, fechaHora } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { abierta: 'neutra', cerrada: 'buena', cancelada: 'mala' };
const FORM = { cliente_id: '', fecha: '', metodo: 'efectivo', exonerar: false };
const p2 = (n) => String(n).padStart(2, '0');
const desdeAhora = (horas) => {
  const d = new Date(Date.now() + horas * 3600000);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
};
const RAPIDOS = [['hora1', 1], ['horas3', 3], ['manana', 24], ['dias3', 72], ['semana1', 168]];

export default function Rentas() {
  const navegar = useNavigate();
  const { t } = useTranslation();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [rentas, setRentas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [disponibles, setDisponibles] = useState([]);
  const [productos, setProductos] = useState([]);
  const [estado, setEstado] = useState('');
  const [form, setForm] = useState(FORM);
  const [cant, setCant] = useState({});
  const [buscar, setBuscar] = useState('');
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
      setRentas(r); setClientes(c); setDisponibles(u); setProductos(p); setError('');
    } catch (e) { setError(e.message); }
  }, [sucursal, estado]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreCliente = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));

  // Piezas disponibles agrupadas por producto (ya vienen ordenadas por código).
  const porProducto = {};
  for (const u of disponibles) (porProducto[u.producto_renta_id] ||= []).push(u);
  const termino = buscar.trim().toLowerCase();
  const lista = productos.filter((p) => (porProducto[p.id]?.length ?? 0) > 0)
    .filter((p) => !termino || [p.codigo, p.nombre, p.categoria].some((x) => String(x).toLowerCase().includes(termino)));
  // El sistema asigna las primeras N piezas disponibles de cada producto.
  const asignadas = productos.flatMap((p) => (porProducto[p.id] ?? []).slice(0, cant[p.id] ?? 0));
  const deposito = productos.reduce((s, p) => s + Number(p.deposito) * Math.min(cant[p.id] ?? 0, porProducto[p.id]?.length ?? 0), 0);

  function cambiarCantidad(p, valor) {
    const max = porProducto[p.id]?.length ?? 0;
    const n = Math.max(0, Math.min(Math.floor(Number(valor) || 0), max));
    setCant({ ...cant, [p.id]: n });
  }

  async function abrir(e) {
    e.preventDefault();
    setError('');
    if (asignadas.length === 0) { setError(t('rentas.errorCantidad')); return; }
    const cuerpo = {
      sucursal_id: Number(sucursal), cliente_id: Number(form.cliente_id),
      fecha_prevista_devolucion: new Date(form.fecha).toISOString(), unidades: asignadas.map((u) => u.id) };
    if (form.exonerar) cuerpo.exonerar_deposito = true; else cuerpo.deposito_metodo = form.metodo;
    try {
      const r = await api('POST', '/rentas', cuerpo);
      navegar(`/rentas/${r.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.rentas')}</h2>
      <form className="formulario" onSubmit={abrir}>
        <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} required>
          <option value="">{t('rentas.clienteOpcion')}</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.telefono || c.bloqueado}>
              {c.nombre}{!c.telefono ? ' (' + t('rentas.sinTelefonoNoRenta') + ')' : ''}{c.bloqueado ? ' (' + t('rentas.bloqueado') + ')' : ''}
            </option>
          ))}
        </select>
        <label className="campo">{t('rentas.devolucionPrevista')}
          <input type="datetime-local" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
        </label>
        <div className="chips ancho">
          {RAPIDOS.map(([texto, horas]) => (
            <button type="button" key={texto} className="secundario"
                    onClick={() => setForm({ ...form, fecha: desdeAhora(horas) })}>{t('rentas.rapido.' + texto)}</button>
          ))}
        </div>

        <div className="ancho">
          <input className="buscador" placeholder={t('rentas.buscar')} value={buscar}
                 onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <div className="tabla-caja ancho">
          <table>
            <thead>
              <tr><th>{t('rentas.codigo')}</th><th>{t('rentas.producto')}</th><th>{t('rentas.categoria')}</th><th className="num">{t('rentas.tarifa')}</th>
                  <th className="num">{t('rentas.deposito')}</th><th className="num">{t('rentas.disponibles')}</th><th className="num">{t('rentas.cantidad')}</th></tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={(cant[p.id] ?? 0) > 0 ? 'sel' : ''}>
                  <td>{p.codigo}</td><td>{p.nombre}</td><td>{p.categoria}</td>
                  <td className="num">{pesos(p.precio)} <span className="suave">/ {p.formato}</span></td>
                  <td className="num">{pesos(p.deposito)}</td>
                  <td className="num">{porProducto[p.id].length}</td>
                  <td className="num">
                    <input className="cantidad" type="number" min="0" max={porProducto[p.id].length} placeholder="0"
                           value={cant[p.id] ?? ''} onChange={(e) => cambiarCantidad(p, e.target.value)} />
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan="7" className="vacio">
                  {productos.length === 0 || disponibles.length === 0
                    ? <>{t('rentas.sinPiezas')} <Link to="/catalogo-renta">{t('menu.catalogo-renta')}</Link>.</>
                    : t('rentas.ningunCoincide')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {asignadas.length > 0 && (
          <p className="ancho suave">{t('rentas.piezasAsignadas')}: {asignadas.map((u) => u.codigo).join(', ')}</p>
        )}

        <label className="check">
          <input type="checkbox" checked={form.exonerar} onChange={(e) => setForm({ ...form, exonerar: e.target.checked })} />
          {t('rentas.exonerar')}
        </label>
        {!form.exonerar && (
          <select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
            <option value="efectivo">{t('rentas.depEfectivo')}</option>
            <option value="transferencia">{t('rentas.depTransferencia')}</option>
            <option value="tarjeta">{t('rentas.depTarjeta')}</option>
            <option value="otro">{t('rentas.depOtro')}</option>
          </select>
        )}
        <button>{t('rentas.abrir')}{asignadas.length > 0 ? ' · ' + t('rentas.nPiezas', { n: asignadas.length }) : ''}{asignadas.length > 0 && !form.exonerar ? ' · ' + t('rentas.conDeposito', { valor: pesos(deposito) }) : ''}</button>
      </form>

      <div className="filtros">
        <select value={sucursal} onChange={(e) => { setSucursal(e.target.value); setCant({}); }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">{t('comun.todosEstados')}</option>
          <option value="abierta">{t('rentas.abiertas')}</option>
          <option value="cerrada">{t('rentas.cerradas')}</option>
          <option value="cancelada">{t('rentas.canceladas')}</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('comun.numero')}</th><th>{t('rentas.thCliente')}</th><th>{t('rentas.thInicio')}</th><th>{t('rentas.devolucionPrevista')}</th><th>{t('comun.estado')}</th>
                <th className="num">{t('rentas.thConsumo')}</th><th className="num">{t('rentas.deposito')}</th><th className="num">{t('rentas.thSaldo')}</th></tr>
          </thead>
          <tbody>
            {rentas.map((r) => {
              const vencida = r.estado === 'abierta' && new Date(r.fecha_prevista_devolucion) < new Date();
              return (
                <tr key={r.id}>
                  <td><Link to={`/rentas/${r.id}`}>{r.numero}</Link></td>
                  <td>{nombreCliente[r.cliente_id] ?? t('rentas.clienteN', { id: r.cliente_id })}</td>
                  <td>{fechaHora(r.fecha_inicio)}</td>
                  <td>{fechaHora(r.fecha_prevista_devolucion)}</td>
                  <td>
                    <span className={`etiqueta ${CLASE[r.estado] ?? 'neutra'}`}>{t('estados.' + r.estado, { defaultValue: r.estado })}</span>
                    {vencida && <span className="etiqueta mala"> {t('rentas.vencida')}</span>}
                  </td>
                  <td className="num">{pesos(r.consumo)}</td>
                  <td className="num">{pesos(r.deposito_en_poder)}</td>
                  <td className="num">{pesos(r.saldo)}</td>
                </tr>
              );
            })}
            {rentas.length === 0 && <tr><td colSpan="8" className="vacio">{t('rentas.sinRentas')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
