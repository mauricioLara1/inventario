import { useEffect, useState } from 'react';
import { api } from '../api';
import { num, pesos } from '../formato';
import Campo from '../Campo';

const TABS = [
  ['ventas', 'Ventas', 'Ventas confirmadas del periodo. "Devuelto" es lo acreditado por notas crédito y "Neto" lo que realmente queda.'],
  ['margenes', 'Márgenes', 'Ganancia por producto: lo que se vendió menos el costo real de los lotes de donde salió.'],
  ['stock-bajo', 'Stock bajo', 'Productos cuyo stock disponible (sin lo vencido) está en el mínimo o por debajo.'],
  ['por-vencer', 'Por vencer', 'Lotes con saldo que vencen pronto o ya vencieron, con el valor que está en riesgo.'],
  ['cuadre', 'Cuadre', 'Revisión de integridad del inventario: debe salir sin descuadres.'],
];
const suma = (filas, campo) => filas.reduce((t, f) => t + Number(f[campo] ?? 0), 0);

export default function Informes() {
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
  const tabs = TABS.filter(([k]) => k !== 'cuadre' || yo?.rol === 'owner');
  const explica = TABS.find(([k]) => k === tab)[2];
  const filas = Array.isArray(datos) ? datos : [];

  return (
    <>
      <h2>Informes</h2>
      <div className="segmentos">
        {tabs.map(([k, texto]) => (
          <button key={k} type="button" className={`segmento ${tab === k ? 'activo' : ''}`}
                  onClick={() => { setTab(k); setDatos(null); }}>{texto}</button>
        ))}
      </div>
      <p className="suave">{explica}</p>

      {tab !== 'cuadre' && (
        <div className="formulario">
          <Campo etiqueta="Sucursal">
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              <option value="">Todas las mías</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
          {['ventas', 'margenes'].includes(tab) && (
            <>
              <Campo etiqueta="Desde" ayuda="Primer día del periodo. Si dejas desde y hasta vacíos, se muestran los últimos 30 días.">
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" ayuda="Último día del periodo (incluido).">
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </Campo>
            </>
          )}
          {tab === 'ventas' && (
            <label className="check">
              <input type="checkbox" checked={porDia} onChange={(e) => setPorDia(e.target.checked)} /> Ver día por día
            </label>
          )}
          {tab === 'por-vencer' && (
            <Campo etiqueta="Vencen en los próximos (días)" ayuda="Muestra los lotes que vencen dentro de este número de días, y también los que ya vencieron.">
              <input type="number" min="0" max="365" value={dias} onChange={(e) => setDias(e.target.value)} />
            </Campo>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {tab === 'ventas' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Sucursal</th>{porDia && <th>Día</th>}<th className="num">Ventas</th><th className="num">Subtotal</th>
              <th className="num">Descuento</th><th className="num">IVA</th><th className="num">Total</th>
              <th className="num">Devuelto</th><th className="num">Neto</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td>{porDia && <td>{f.dia}</td>}
                  <td className="num">{num(f.ventas)}</td><td className="num">{pesos(f.subtotal)}</td>
                  <td className="num">{pesos(f.descuento)}</td><td className="num">{pesos(f.impuesto)}</td>
                  <td className="num">{pesos(f.total)}</td><td className="num">{pesos(f.total_acreditado)}</td>
                  <td className="num">{pesos(f.neto)}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={porDia ? 9 : 8} className="vacio">Sin ventas en este periodo</td></tr>}
            </tbody>
            {filas.length > 1 && (
              <tfoot><tr><td colSpan={porDia ? 3 : 2} className="num"><strong>Totales</strong></td>
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
            <thead><tr><th>Producto</th><th>Sucursal</th><th className="num">Vendidas</th><th className="num">Devueltas</th>
              <th className="num">Ingreso neto</th><th className="num">Costo</th><th className="num">Margen</th><th className="num">%</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{f.codigo} · {f.nombre}</td><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td>
                  <td className="num">{num(f.cantidad_vendida)}</td><td className="num">{num(f.cantidad_acreditada)}</td>
                  <td className="num">{pesos(f.ingreso_neto)}</td><td className="num">{pesos(f.costo)}</td>
                  <td className="num"><strong>{pesos(f.margen)}</strong></td>
                  <td className="num">{Number(f.ingreso_neto) > 0 ? (Number(f.margen) / Number(f.ingreso_neto) * 100).toFixed(1) + '%' : '—'}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="8" className="vacio">Sin ventas en este periodo</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock-bajo' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Sucursal</th><th>Producto</th><th className="num">Disponible</th><th className="num">Vencido</th>
              <th className="num">Mínimo</th><th className="num">Faltan</th></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td><td>{f.codigo} · {f.nombre}</td>
                  <td className="num">{num(f.cantidad_vendible)}</td>
                  <td className="num">{Number(f.cantidad_vencida) > 0 ? num(f.cantidad_vencida) : '—'}</td>
                  <td className="num">{num(f.stock_minimo)}</td>
                  <td className="num"><strong>{num(Math.max(0, Number(f.stock_minimo) - Number(f.cantidad_vendible)))}</strong></td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="6" className="vacio">Ningún producto con stock bajo ✔</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'por-vencer' && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Sucursal</th><th>Producto</th><th>Lote</th><th className="num">Cantidad</th><th>Caduca</th>
              <th className="num">Días</th><th>Estado</th><th className="num">Valor en riesgo</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.lote_id}><td>{nombre[f.sucursal_id] ?? f.sucursal_id}</td><td>{f.codigo} · {f.nombre}</td>
                  <td>{f.lote_id}</td><td className="num">{num(f.saldo)}</td><td>{f.fecha_caducidad}</td>
                  <td className="num">{f.dias_para_vencer}</td>
                  <td><span className={`etiqueta ${f.vencido ? 'mala' : 'neutra'}`}>{f.vencido ? 'vencido' : 'por vencer'}</span></td>
                  <td className="num">{pesos(f.valor_en_riesgo)}</td></tr>
              ))}
              {filas.length === 0 && <tr><td colSpan="8" className="vacio">Nada por vencer en este plazo ✔</td></tr>}
            </tbody>
            {filas.length > 0 && (
              <tfoot><tr><td colSpan="7" className="num"><strong>Total en riesgo</strong></td>
                <td className="num"><strong>{pesos(suma(filas, 'valor_en_riesgo'))}</strong></td></tr></tfoot>
            )}
          </table>
        </div>
      )}

      {tab === 'cuadre' && datos && (
        datos.cuadra
          ? <p className="guia ok">Todo cuadra: el saldo de cada lote coincide con su historial de movimientos.</p>
          : (
            <>
              <p className="guia aviso">Hay {datos.descuadres.length} lote(s) que no cuadran. Avísale al soporte técnico.</p>
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
