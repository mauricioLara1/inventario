import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { borrador: 'neutra', confirmada: 'buena' };
const REEMBOLSO = { metodo: 'efectivo', monto: '', referencia: '' };

export default function NotaCreditoDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { t } = useTranslation();
  const [n, setN] = useState(null);
  const [venta, setVenta] = useState(null);
  const [linea, setLinea] = useState({ venta_detalle_id: '', cantidad: '' });
  const [reingreso, setReingreso] = useState({});
  const [reembolso, setReembolso] = useState(REEMBOLSO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const nota = await api('GET', `/notas-credito/${id}`);
      setN(nota);
      setVenta(await api('GET', `/ventas/${nota.venta_id}`));
      setError('');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); if (mensaje) setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }

  const agregar = (e) => {
    e.preventDefault();
    hacer(async () => {
      await api('POST', `/notas-credito/${id}/lineas`,
        { venta_detalle_id: Number(linea.venta_detalle_id), cantidad: Number(linea.cantidad) });
      setLinea({ venta_detalle_id: '', cantidad: '' });
    });
  };
  const quitar = (l) => hacer(() => api('DELETE', `/notas-credito/${id}/lineas/${l.id}`));
  const confirmar = () => {
    if (!window.confirm(t('notaDetalle.confirmConfirmar'))) return;
    hacer(() => api('POST', `/notas-credito/${id}/confirmar`), t('notaDetalle.confirmada'));
  };
  const borrar = async () => {
    if (!window.confirm(t('notaDetalle.confirmBorrar'))) return;
    try { await api('DELETE', `/notas-credito/${id}`); navegar('/notas-credito'); } catch (e) { setError(e.message); }
  };
  const reingresar = (l) => hacer(
    () => api('POST', `/notas-credito/${id}/reingresos`,
      { nota_credito_detalle_id: l.id, cantidad: Number(reingreso[l.id]) }),
    t('notaDetalle.reingresoOk'));
  const reembolsar = (e) => {
    e.preventDefault();
    const cuerpo = { metodo: reembolso.metodo, monto: Number(reembolso.monto) };
    if (reembolso.referencia.trim()) cuerpo.referencia = reembolso.referencia.trim();
    hacer(async () => { await api('POST', `/notas-credito/${id}/reembolsos`, cuerpo); setReembolso(REEMBOLSO); },
      t('notaDetalle.reembolsoOk'));
  };

  if (!n || !venta) return <>{error ? <p className="error">{error}</p> : <p className="suave">{t('comun.cargando')}</p>}</>;
  const borrador = n.estado === 'borrador';
  const porLinea = Object.fromEntries(venta.lineas.map((l) => [l.id, l]));
  const aFavor = Number(venta.saldo) < 0 ? -Number(venta.saldo) : 0;

  return (
    <>
      <p><Link to="/notas-credito">← {t('menu.notas-credito')}</Link> · <Link to={`/ventas/${n.venta_id}`}>{t('ventaDetalle.venta')} {venta.numero}</Link></p>
      <h2>{t('notaDetalle.nota')} {n.numero} <span className={`etiqueta ${CLASE[n.estado]}`}>{t('estados.' + n.estado, { defaultValue: n.estado })}</span></h2>
      <p className="suave">{fecha(n.fecha)} · {t('notasCredito.motivo')}: {n.motivo}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={linea.venta_detalle_id} onChange={(e) => setLinea({ ...linea, venta_detalle_id: e.target.value })} required>
            <option value="">{t('notaDetalle.productoOpcion')}</option>
            {venta.lineas.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre} · {t('notaDetalle.vendidas')} {num(l.cantidad)}</option>)}
          </select>
          <input type="number" min="0" step="any" placeholder={t('notaDetalle.cantidadPh')} value={linea.cantidad}
                 onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })} required />
          <button>{t('notaDetalle.agregar')}</button>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('notaDetalle.thProducto')}</th><th className="num">{t('notaDetalle.cantidad')}</th><th className="num">{t('comun.total')}</th>
                {!borrador && <th className="num">{t('notaDetalle.thReingresado')}</th>}{!borrador && <th>{t('notaDetalle.thReingresar')}</th>}{borrador && <th />}</tr>
          </thead>
          <tbody>
            {n.lineas.map((l) => {
              const v = porLinea[l.venta_detalle_id];
              const pendiente = Number(l.cantidad) - Number(l.reingresado);
              return (
                <tr key={l.id}>
                  <td>{v ? `${v.codigo} · ${v.nombre}` : t('notaDetalle.linea', { id: l.venta_detalle_id })}</td>
                  <td className="num">{num(l.cantidad)}</td>
                  <td className="num">{pesos(l.total)}</td>
                  {!borrador && <td className="num">{t('notaDetalle.reingresadoDe', { a: num(l.reingresado), b: num(l.cantidad) })}</td>}
                  {!borrador && (
                    <td>
                      {pendiente > 0 ? (
                        <span className="fila-acciones">
                          <input type="number" min="0" step="any" max={pendiente} placeholder={t('notaDetalle.hasta', { n: num(pendiente) })}
                                 value={reingreso[l.id] ?? ''} className="precio"
                                 onChange={(e) => setReingreso({ ...reingreso, [l.id]: e.target.value })} />
                          <button className="secundario" onClick={() => reingresar(l)}>{t('notaDetalle.reingresar')}</button>
                        </span>
                      ) : <span className="suave">{t('notaDetalle.completo')}</span>}
                    </td>
                  )}
                  {borrador && <td><button className="secundario" onClick={() => quitar(l)}>{t('notaDetalle.quitar')}</button></td>}
                </tr>
              );
            })}
            {n.lineas.length === 0 && <tr><td colSpan="5" className="vacio">{t('notaDetalle.sinLineas')}</td></tr>}
          </tbody>
          <tfoot>
            <tr><td className="num">{t('notaDetalle.subtotal')}</td><td /><td className="num">{pesos(n.subtotal)}</td><td colSpan="2" /></tr>
            <tr><td className="num">{t('notaDetalle.iva')}</td><td /><td className="num">{pesos(n.impuesto)}</td><td colSpan="2" /></tr>
            <tr><td className="num"><strong>{t('notaDetalle.totalFavor')}</strong></td><td /><td className="num"><strong>{pesos(n.total)}</strong></td><td colSpan="2" /></tr>
          </tfoot>
        </table>
      </div>

      {borrador && (
        <div className="acciones">
          <button onClick={confirmar} disabled={n.lineas.length === 0}>{t('notaDetalle.confirmarBtn')}</button>
          <button className="secundario" onClick={borrar}>{t('notaDetalle.borrarBtn')}</button>
        </div>
      )}

      {!borrador && (
        <>
          <h3>{t('notaDetalle.reembolsos')}</h3>
          <p className="suave">
            {t('notaDetalle.notaReembolso')}{' '}
            {aFavor > 0 ? t('notaDetalle.pendiente', { valor: pesos(aFavor) }) : t('notaDetalle.sinPendiente')}
          </p>
          {n.reembolsos.length > 0 && (
            <div className="tabla-caja">
              <table>
                <thead><tr><th>{t('comun.fecha')}</th><th>{t('ventaDetalle.thMetodo')}</th><th>{t('ventaDetalle.thReferencia')}</th><th className="num">{t('ventaDetalle.thMonto')}</th></tr></thead>
                <tbody>
                  {n.reembolsos.map((r) => (
                    <tr key={r.id}><td>{fecha(r.fecha)}</td><td>{t('metodos.' + r.metodo, { defaultValue: r.metodo })}</td><td>{r.referencia ?? '—'}</td>
                        <td className="num">{pesos(r.monto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {aFavor > 0 && (
            <form className="formulario" onSubmit={reembolsar}>
              <select value={reembolso.metodo} onChange={(e) => setReembolso({ ...reembolso, metodo: e.target.value })}>
                <option value="efectivo">{t('metodos.efectivo')}</option>
                <option value="transferencia">{t('metodos.transferencia')}</option>
                <option value="tarjeta">{t('metodos.tarjeta')}</option>
                <option value="otro">{t('metodos.otro')}</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder={t('ventaDetalle.thMonto')} value={reembolso.monto}
                     onChange={(e) => setReembolso({ ...reembolso, monto: e.target.value })} required />
              <input placeholder={t('ventaDetalle.referenciaPh')} value={reembolso.referencia}
                     onChange={(e) => setReembolso({ ...reembolso, referencia: e.target.value })} />
              <button>{t('notaDetalle.registrarReembolso')}</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
