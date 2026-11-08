import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from "react-router-dom";
import { api } from '../api';
import { pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { borrador: 'neutra', recibida: 'buena', anulada: 'mala' };

export default function Compras() {
  const navegar = useNavigate();
  const { t } = useTranslation();
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
      navegar(`/compras/${c.id}`);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.compras')}</h2>
      <p className="suave">{t('compras.faltaProveedor')} <Link to="/proveedores">{t('compras.crealoAqui')}</Link></p>
      <form className="formulario" onSubmit={crearCompra}>
        <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} required>
          <option value="">{t('compras.proveedorOpcion')}</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <input placeholder={t('compras.placeholderFactura')} value={factura}
               onChange={(e) => setFactura(e.target.value)} />
        <button>{t('compras.nueva')}</button>
      </form>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">{t('comun.todosEstados')}</option>
          <option value="borrador">{t('estados.borrador')}</option>
          <option value="recibida">{t('estados.recibida')}</option>
          <option value="anulada">{t('estados.anulada')}</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('comun.numero')}</th><th>{t('comun.fecha')}</th><th>{t('compras.proveedor')}</th><th>{t('compras.factura')}</th><th>{t('comun.estado')}</th><th className="num">{t('comun.total')}</th></tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/compras/${c.id}`}>{c.numero}</Link></td><td>{fecha(c.fecha)}</td><td>{c.proveedor}</td>
                <td>{c.numero_factura_proveedor ?? '—'}</td>
                <td><span className={`etiqueta ${CLASE[c.estado] ?? 'neutra'}`}>{t('estados.' + c.estado, { defaultValue: c.estado })}</span></td>
                <td className="num">{pesos(c.total)}</td>
              </tr>
            ))}
            {compras.length === 0 && <tr><td colSpan="6" className="vacio">{t('compras.sinCompras')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
