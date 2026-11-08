import { useEffect, useState } from 'react';
import { api } from '../api';
import { fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const num = (x) => Number(x).toLocaleString('es-CO', { maximumFractionDigits: 3 });
const pesos = (x) => (x === null || x === undefined ? '—'
  : Number(x).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));

// Fecha en que vence el lote mas viejo que aun tiene stock.
function vencimiento(f, t) {
  if (Number(f.cantidad) <= 0) return '—';
  if (!f.proximo_vencimiento) return <span className="suave">{t('inventario.sinCaducidad')}</span>;
  const d = Number(f.dias_para_vencer);
  const texto = d < 0 ? t('inventario.vencidoHace', { d: -d }) : d === 0 ? t('inventario.venceHoy') : t('inventario.en', { d });
  return <>{fecha(f.proximo_vencimiento)} <span className={d <= 7 ? 'etiqueta mala' : 'suave'}>{texto}</span></>;
}

export default function Inventario() {
  const { t } = useTranslation();
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
      <h2>{t('menu.inventario')}</h2>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder={t('inventario.buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> {t('inventario.soloBajo')}
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('inventario.codigo')}</th><th>{t('inventario.producto')}</th><th className="num">{t('inventario.disponible')}</th>
                <th className="num">{t('inventario.vencido')}</th><th>{t('inventario.proxVenc')}</th><th className="num">{t('inventario.minimo')}</th>
                <th className="num">{t('inventario.precio')}</th><th>{t('inventario.estado')}</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.producto_id}>
                <td>{f.codigo}</td>
                <td>{f.nombre}{f.medida ? <span className="suave"> · {f.medida}</span> : null}</td>
                <td className="num">{num(f.cantidad_vendible)}</td>
                <td className="num">{Number(f.cantidad_vencida) > 0 ? num(f.cantidad_vencida) : '—'}</td>
                <td>{vencimiento(f, t)}</td>
                <td className="num">{num(f.stock_minimo)}</td>
                <td className="num">{pesos(precios[f.producto_id])}</td>
                <td><span className={f.stock_bajo ? 'etiqueta mala' : 'etiqueta buena'}>
                  {f.stock_bajo ? t('inventario.stockBajo') : t('inventario.ok')}</span></td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan="8" className="vacio">{t('inventario.sinProductos')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
