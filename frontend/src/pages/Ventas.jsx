import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { pesos, fecha } from '../formato';
import Buscador from '../Buscador';
import Campo from '../Campo';

const CLASE = { borrador: 'neutra', confirmada: 'buena', anulada: 'mala' };
const titCliente = (c) => (c.consumidorFinal ? c.nombre : c.nombre + (c.numero_documento ? ' · ' + c.numero_documento : ''));

export default function Ventas() {
  const navegar = useNavigate();
  const { t } = useTranslation();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [cliente, setCliente] = useState(null); // para la venta nueva
  const [ventas, setVentas] = useState([]);
  const [estado, setEstado] = useState('');
  const [fVendedor, setFVendedor] = useState(null);
  const [fCliente, setFCliente] = useState(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [empleados, setEmpleados] = useState([]);
  const [yo, setYo] = useState(null);
  const [error, setError] = useState('');
  const verEmpleados = !!yo?.permisos?.includes('usuarios.gestionar');
  const hayFiltros = !!(estado || fVendedor || fCliente || desde || hasta);

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    const p = new URLSearchParams({ sucursal_id: sucursal });
    if (estado) p.set('estado', estado);
    if (fVendedor) p.set('vendedor_id', fVendedor.id);
    if (fCliente) {
      if (fCliente.consumidorFinal) p.set('sin_cliente', 'true'); else p.set('cliente_id', fCliente.id);
    }
    if (desde) p.set('desde', new Date(desde + 'T00:00:00').toISOString());
    if (hasta) p.set('hasta', new Date(hasta + 'T23:59:59.999').toISOString());
    try { setVentas(await api('GET', `/ventas?${p}`)); setError(''); } catch (e) { setError(e.message); }
  }, [sucursal, estado, fVendedor, fCliente, desde, hasta]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
    api('GET', '/auth/yo').then(setYo).catch(() => {});
  }, []);
  useEffect(() => {
    if (verEmpleados) api('GET', '/usuarios').then(setEmpleados).catch(() => {});
  }, [verEmpleados]);
  useEffect(() => { cargar(); }, [cargar]);

  const limpiar = () => { setEstado(''); setFVendedor(null); setFCliente(null); setDesde(''); setHasta(''); };

  // "Consumidor final" va de primera en la lista (venta sin cliente registrado).
  const buscarClientes = async (q) => {
    const r = await api('GET', '/clientes?q=' + encodeURIComponent(q));
    const cf = { id: 'cf', nombre: t('ventas.consumidorFinal'), consumidorFinal: true };
    return !q || cf.nombre.toLowerCase().includes(q.toLowerCase()) ? [cf, ...r] : r;
  };
  const buscarVendedores = async (q) => {
    const s = q.toLowerCase();
    return empleados.filter((u) => u.activo !== false && ((u.nombre || '') + ' ' + (u.usuario || '')).toLowerCase().includes(s));
  };
  const detalleCliente = (c) => {
    if (c.consumidorFinal) return t('ventas.sinCliente');
    return c.bloqueado ? t('ventas.bloqueado') : c.telefono || t('ventas.sinTelefono');
  };

  async function crear(e) {
    e.preventDefault();
    setError('');
    const cuerpo = { sucursal_id: Number(sucursal) };
    if (cliente && !cliente.consumidorFinal) cuerpo.cliente_id = Number(cliente.id);
    try {
      const v = await api('POST', '/ventas', cuerpo);
      navegar(`/ventas/${v.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.ventas')}</h2>
      <form className="formulario" onSubmit={crear}>
        <Buscador valor={cliente} onChange={setCliente} buscar={buscarClientes}
                  placeholder={t('ventas.clientePh')} titulo={titCliente} detalle={detalleCliente}
                  exacto={(c, q) => c.numero_documento === q} />
        <button>{t('ventas.nuevaVenta')}</button>
      </form>
      <div className="filtros filtros-ventas">
        <Campo etiqueta={t('ventas.sucursal')}>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('ventas.estado')}>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">{t('comun.todosEstados')}</option>
            <option value="borrador">{t('estados.borrador')}</option>
            <option value="confirmada">{t('estados.confirmada')}</option>
          </select>
        </Campo>
        {verEmpleados && (
          <Buscador etiqueta={t('ventas.vendedor')} ayuda={t('ventas.ayudaVendedor')}
                    valor={fVendedor} onChange={setFVendedor} buscar={buscarVendedores}
                    placeholder={t('ventas.vendedorPh')} titulo={(u) => u.nombre} detalle={(u) => u.usuario} />
        )}
        <Buscador etiqueta={t('ventas.cliente')} valor={fCliente} onChange={setFCliente} buscar={buscarClientes}
                  placeholder={t('ventas.filtrarCliente')} titulo={titCliente} detalle={detalleCliente} />
        <Campo etiqueta={t('ventas.desde')}>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('ventas.hasta')}>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
        {hayFiltros && <button type="button" className="secundario" onClick={limpiar}>{t('ventas.limpiar')}</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('ventas.thNumero')}</th><th>{t('ventas.thFecha')}</th><th>{t('ventas.thCliente')}</th>
                <th>{t('ventas.thVendedor')}</th><th>{t('ventas.thEstado')}</th>
                <th className="num">{t('ventas.thTotal')}</th><th className="num">{t('ventas.thSaldo')}</th></tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id}>
                <td><Link to={`/ventas/${v.id}`}>{v.numero}</Link></td>
                <td>{fecha(v.fecha)}</td>
                <td>{v.cliente ?? t('ventas.consumidorFinal')}</td>
                <td>{v.vendedor}</td>
                <td><span className={`etiqueta ${CLASE[v.estado] ?? 'neutra'}`}>{t('estados.' + v.estado, { defaultValue: v.estado })}</span></td>
                <td className="num">{pesos(v.total)}</td>
                <td className="num">{v.estado === 'confirmada' ? pesos(v.saldo) : '—'}</td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td colSpan="7" className="vacio">{t('ventas.sinVentas')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
