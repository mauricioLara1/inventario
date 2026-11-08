import { useEffect, useState } from 'react';
import { api } from '../api';
import { num, pesos } from '../formato';
import Campo from '../Campo';
import { useTranslation } from 'react-i18next';

const TABS = [
  ['ventas', 'Ventas', 'Ventas confirmadas del periodo. "Devuelto" es lo acreditado por notas crédito y "Neto" lo que realmente queda.'],
  ['margenes', 'Márgenes', 'Ganancia por producto: lo que se vendió menos el costo real de los lotes de donde salió.'],
  ['stock-bajo', 'Stock bajo', 'Productos cuyo stock disponible (sin lo vencido) está en el mínimo o por debajo.'],
  ['por-vencer', 'Por vencer', 'Lotes con saldo que vencen pronto o ya vencieron, con el valor que está en riesgo.'],
  ['cuadre', 'Cuadre', 'Revisión de integridad del inventario: debe salir sin descuadres.'],
];
const suma = (filas, campo) => filas.reduce((t, f) => t + Number(f[campo] ?? 0), 0);

export default function Informes() {
  const { t } = useTranslation();
  const [yo, setYo] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [tab, setTab] = useState('ventas');
  const [sucursal, setSucursal] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [porDia, setPorDia] = useState(false);
  const [dias, setDias] = useState('30');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', '/auth/yo').then(setYo).catch(() => {});
    api('GET', '/sucursales').then(setSucursales).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams();
    if (sucursal && tab !== 'cuadre') p.set('sucursal_id', sucursal);
    if (['ventas', 'margenes'].includes(tab)) {
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
    }
    if (tab === 'ventas' && porDia) p.set('agrupar', 'dia');
    if (tab === 'por-vencer') p.set('dias', dias || '30');
    api('GET', `/informes/${tab}?${p}`)
      .then((d) => { if (vigente) { setDatos(d); setError(''); } })
      .catch((e) => { if (vigente) { setDatos(null); setError(e.message); } });
    return () => { vigente = false; };
  }, [tab, sucursal, desde, hasta, porDia, dias]);

  const nombre = Object.fromEntries(sucursales.map((s) => [s.id, s.nombre]));
  const tabs = TABS.filter(([k]) => k !== 'cuadre' || yo?.permisos?.includes('informes.cuadre'));
  const explica = t('informes.expl.' + tab);
  const filas = Array.isArray(datos) ? datos : [];

  return (
    <>
      <h2>{t('menu.informes')}</h2>
      <div className="segmentos">
        {tabs.map(([k]) => (
          <button key={k} type="button" className={`segmento ${tab === k ? 'activo' : ''}`}
                  onClick={() => { setTab(k); setDatos(null); }}>{t('informes.tab.' + k)}</button>
        ))}
      </div>
      <p className="suave">{explica}</p>

      {tab !== 'cuadre' && (
        <div className="formulario">
          <Campo etiqueta={t('informes.sucursal')}>
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              <option value="">{t('informes.todasMias')}</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
          {['ventas', 'margenes'].includes(tab) && (
            <>
              <Campo etiqueta={t('informes.desde')} ayuda={t('informes.ayudaDesde')}>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta={t('informes.hasta')} ayuda={t('informes.ayudaHasta')}>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </Campo>
            </>
          )}
          {tab === 'ventas' && (
            <label className="check">
              <input type="checkbox" checked={porDia} onChange={(e) => setPorDia(e.target.checked)} /> {t('informes.porDia')}
            </label>
          )}
          {tab === 'por-vencer' && (
            <Campo etiqueta={t('informes.vencenEn')} ayuda={t('informes.ayudaVencenEn')}>
              <input type="number" min="0" max="365" value={dias} onChange={(e) => setDias(e.target.value)} />
            </Campo>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {tab === 'ventas' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('informes.thSucursal')}</th>{porDia && <th>{t('informes.thDia')}</th>}<th className="num">{t('informes.thVentas')}</th><th className="num">{t('informes.thSubtotal')}</th>
              <th className="num">{t('informes.thDescuento')}</th><th className="num">{t('informes.thIva')}</th><th className="num">{t('comun.total')}</th>
              <th className="num">{t('informes.thDevuelto')}</th><th className="num">{t('informes.thNeto')}</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td>{porDia && <td>{f.dia}</td>}
                  <td className="num">{num(f.ventas)}</td><td className="num">{pesos(f.subtotal)}</td>
                  <td className="num">{pesos(f.descuento)}</td><td className="num">{pesos(f.impuesto)}</td>
                  <td className="num">{pesos(f.total)}</td><td className="num">{pesos(f.total_acreditado)}</td>
                  <td className="num">{pesos(f.neto)}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={porDia ? 9 : 8} className="vacio">{t('informes.sinVentas')}</td></tr>}
            </tbody>
            {filas.length > 1 && (
              <tfoot><tr><td colSpan={porDia ? 3 : 2} className="num"><strong>{t('informes.totales')}</strong></td>
                <td className="num" /><td className="num" /><td className="num" />
                <td className="num"><strong>{pesos(suma(filas, 'total'))}</strong></td>
                <td className="num">{pesos(suma(filas, 'total_acreditado'))}</td>
                <td className="num"><strong>{pesos(suma(filas, 'neto'))}</strong></td></tr></tfoot>
            )}
          </table>
        </div>
      )}

      {tab === 'margenes' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('informes.thProducto')}</th><th>{t('informes.thSucursal')}</th><th className="num">{t('informes.thVendidas')}</th><th className="num">{t('informes.thDevueltas')}</th>
              <th className="num">{t('informes.thIngresoNeto')}</th><th className="num">{t('informes.thCosto')}</th><th className="num">{t('informes.thMargen')}</th><th className="num">%</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{f.codigo} · {f.nombre}</td><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td>
                  <td className="num">{num(f.cantidad_vendida)}</td><td className="num">{num(f.cantidad_acreditada)}</td>
                  <td className="num">{pesos(f.ingreso_neto)}</td><td className="num">{pesos(f.costo)}</td>
                  <td className="num"><strong>{pesos(f.margen)}</strong></td>
                  <td className="num">{Number(f.ingreso_neto) > 0 ? (Number(f.margen) / Number(f.ingreso_neto) * 100).toFixed(1) + '%' : '—'}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="8" className="vacio">{t('informes.sinVentas')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock-bajo' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('informes.thSucursal')}</th><th>{t('informes.thProducto')}</th><th className="num">{t('informes.thDisponible')}</th><th className="num">{t('informes.thVencido')}</th>
              <th className="num">{t('informes.thMinimo')}</th><th className="num">{t('informes.thFaltan')}</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td><td>{f.codigo} · {f.nombre}</td>
                  <td className="num">{num(f.cantidad_vendible)}</td>
                  <td className="num">{Number(f.cantidad_vencida) > 0 ? num(f.cantidad_vencida) : '—'}</td>
                  <td className="num">{num(f.stock_minimo)}</td>
                  <td className="num"><strong>{num(Math.max(0, Number(f.stock_minimo) - Number(f.cantidad_vendible)))}</strong></td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="6" className="vacio">{t('informes.sinStockBajo')} ✔</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'por-vencer' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('informes.thSucursal')}</th><th>{t('informes.thProducto')}</th><th>{t('informes.thLote')}</th><th className="num">{t('informes.thCantidad')}</th><th>{t('informes.thCaduca')}</th>
              <th className="num">{t('informes.thDias')}</th><th>{t('comun.estado')}</th><th className="num">{t('informes.thValorRiesgo')}</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.lote_id}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td><td>{f.codigo} · {f.nombre}</td>
                  <td>{f.lote_id}</td><td className="num">{num(f.saldo)}</td><td>{f.fecha_caducidad}</td>
                  <td className="num">{f.dias_para_vencer}</td>
                  <td><span className={`etiqueta ${f.vencido ? 'mala' : 'neutra'}`}>{f.vencido ? t('informes.vencido') : t('informes.porVencer')}</span></td>
                  <td className="num">{pesos(f.valor_en_riesgo)}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="8" className="vacio">{t('informes.nadaPorVencer')} ✔</td></tr>}
            </tbody>
            {filas.length > 0 && (
              <tfoot><tr><td colSpan="7" className="num"><strong>{t('informes.totalRiesgo')}</strong></td>
                <td className="num"><strong>{pesos(suma(filas, 'valor_en_riesgo'))}</strong></td></tr></tfoot>
            )}
          </table>
        </div>
      )}

      {tab === 'cuadre' && datos && (
        datos.cuadra
          ? <p className="guia ok">{t('informes.todoCuadra')}</p>
          : (
            <>
              <p className="guia aviso">{t('informes.hayDescuadres', { n: datos.descuadres.length })}</p>
              <div className="tabla-caja"><table>
                <thead><tr>{Object.keys(datos.descuadres[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{datos.descuadres.map((d, i) => <tr key={i}>{Object.values(d).map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
              </table></div>
            </>
          )
      )}
    </>
  );
}
