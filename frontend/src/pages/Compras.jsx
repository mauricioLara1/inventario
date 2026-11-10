import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';
import { usePermisos } from '../permisos';
import Buscador from '../Buscador';
import Campo from '../Campo';

const CLASE = { borrador: 'neutra', recibida: 'buena', anulada: 'mala' };

export default function Compras() {
  const navegar = useNavigate();
  const { t } = useTranslation();
  const { puede } = usePermisos();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [compras, setCompras] = useState([]);
  const [proveedor, setProveedor] = useState(null); // para la compra nueva
  const [factura, setFactura] = useState('');
  const [estado, setEstado] = useState('');
  const [fProveedor, setFProveedor] = useState(null);
  const [fEmpleado, setFEmpleado] = useState(null);
  const [fBuscar, setFBuscar] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [montoMin, setMontoMin] = useState('');
  const [montoMax, setMontoMax] = useState('');
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const verEmpleados = puede('usuarios.gestionar');
  const hayFiltros = !!(estado || fProveedor || fEmpleado || fBuscar || desde || hasta || montoMin || montoMax);

  const cargar = useCallback(async () => {
    if (!sucursal) return;
    const p = new URLSearchParams({ sucursal_id: sucursal });
    if (estado) p.set('estado', estado);
    if (fProveedor) p.set('proveedor_id', fProveedor.id);
    if (fEmpleado) p.set('recibida_por', fEmpleado.id);
    if (fBuscar.trim()) p.set('q', fBuscar.trim());
    if (montoMin !== '') p.set('total_min', montoMin);
    if (montoMax !== '') p.set('total_max', montoMax);
    if (desde) p.set('desde', new Date(desde + 'T00:00:00').toISOString());
    if (hasta) p.set('hasta', new Date(hasta + 'T23:59:59.999').toISOString());
    try { setCompras(await api('GET', `/compras?${p}`)); setError(''); } catch (e) { setError(e.message); }
  }, [sucursal, estado, fProveedor, fEmpleado, fBuscar, desde, hasta, montoMin, montoMax]);

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (verEmpleados) api('GET', '/usuarios').then(setEmpleados).catch(() => {});
  }, [verEmpleados]);
  useEffect(() => { cargar(); }, [cargar]);

  const limpiar = () => {
    setEstado(''); setFProveedor(null); setFEmpleado(null); setFBuscar('');
    setDesde(''); setHasta(''); setMontoMin(''); setMontoMax('');
  };

  const buscarProveedores = async (q) =>
    (await api('GET', '/proveedores?q=' + encodeURIComponent(q))).filter((x) => x.activo !== false);
  const buscarEmpleados = async (q) => {
    const s = q.toLowerCase();
    return empleados.filter((u) => u.activo !== false && ((u.nombre || '') + ' ' + (u.usuario || '')).toLowerCase().includes(s));
  };

  async function crearCompra(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = { sucursal_id: Number(sucursal), proveedor_id: Number(proveedor.id) };
    if (factura.trim()) cuerpo.numero_factura_proveedor = factura.trim();
    try {
      const c = await api('POST', '/compras', cuerpo);
      navegar(`/compras/${c.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.compras')}</h2>
      {puede('compras.gestionar') && (
        <>
          <p className="suave">{t('compras.faltaProveedor')} <Link to="/proveedores">{t('compras.crealoAqui')}</Link></p>
          <form className="formulario" onSubmit={crearCompra}>
            <Buscador valor={proveedor} onChange={setProveedor} buscar={buscarProveedores} requerido
                      placeholder={t('compras.proveedorPh')} titulo={(p) => p.nombre} detalle={(p) => p.nit} />
            <input placeholder={t('compras.placeholderFactura')} value={factura}
                   onChange={(e) => setFactura(e.target.value)} />
            <button>{t('compras.nueva')}</button>
          </form>
        </>
      )}
      <div className="filtros filtros-ventas">
        <Campo etiqueta={t('compras.sucursal')}>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('comun.estado')}>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">{t('comun.todosEstados')}</option>
            <option value="borrador">{t('estados.borrador')}</option>
            <option value="recibida">{t('estados.recibida')}</option>
            <option value="anulada">{t('estados.anulada')}</option>
          </select>
        </Campo>
        <Buscador etiqueta={t('compras.proveedor')} valor={fProveedor} onChange={setFProveedor} buscar={buscarProveedores}
                  placeholder={t('compras.filtrarProveedor')} titulo={(p) => p.nombre} detalle={(p) => p.nit} />
        <Campo etiqueta={t('compras.etBuscar')} ayuda={t('compras.ayudaBuscar')}>
          <input value={fBuscar} onChange={(e) => setFBuscar(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('compras.desde')}>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('compras.hasta')}>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('compras.montoMin')} ayuda={t('compras.ayudaMonto')}>
          <input type="number" min="0" step="any" value={montoMin} onChange={(e) => setMontoMin(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('compras.montoMax')}>
          <input type="number" min="0" step="any" value={montoMax} onChange={(e) => setMontoMax(e.target.value)} />
        </Campo>
        {verEmpleados && (
          <Buscador etiqueta={t('compras.recibidaPor')} ayuda={t('compras.ayudaRecibidaPor')}
                    valor={fEmpleado} onChange={setFEmpleado} buscar={buscarEmpleados}
                    placeholder={t('compras.empleadoPh')} titulo={(u) => u.nombre} detalle={(u) => u.usuario} />
        )}
        {hayFiltros && <button type="button" className="secundario" onClick={limpiar}>{t('compras.limpiar')}</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('comun.numero')}</th><th>{t('comun.fecha')}</th><th>{t('compras.proveedor')}</th><th>{t('compras.factura')}</th>
                <th>{t('compras.recibidaPor')}</th><th>{t('comun.estado')}</th><th className="num">{t('comun.total')}</th></tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/compras/${c.id}`}>{c.numero}</Link></td><td>{fecha(c.fecha)}</td><td>{c.proveedor}</td>
                <td>{c.numero_factura_proveedor ?? '—'}</td>
                <td>{c.recibida_por_nombre}</td>
                <td><span className={`etiqueta ${CLASE[c.estado] ?? 'neutra'}`}>{t('estados.' + c.estado, { defaultValue: c.estado })}</span></td>
                <td className="num">{pesos(c.total)}</td>
              </tr>
            ))}
            {compras.length === 0 && <tr><td colSpan="7" className="vacio">{t('compras.sinCompras')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
