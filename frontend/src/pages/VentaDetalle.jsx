import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { borrador: 'neutra', confirmada: 'buena', anulada: 'mala' };
const VACIA = { producto_id: '', cantidad: '', descuento_porcentaje: '' };
const PAGO = { metodo: 'efectivo', monto: '', referencia: '' };

export default function VentaDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { t } = useTranslation();
  const [v, setV] = useState(null);
  const [productos, setProductos] = useState([]);
  const [stock, setStock] = useState({});
  const [form, setForm] = useState(VACIA);
  const [pago, setPago] = useState(PAGO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const venta = await api('GET', `/ventas/${id}`);
      setV(venta);
      const p = await api('GET', `/catalogo/productos?sucursal_id=${venta.sucursal_id}`);
      setProductos(p.filter((x) => x.activo));
      const st = await api('GET', '/inventario/stock?sucursal_id=' + venta.sucursal_id);
      setStock(Object.fromEntries(st.map((x) => [x.producto_id, Number(x.cantidad_vendible)])));
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
    const cuerpo = { producto_id: Number(form.producto_id), cantidad: Number(form.cantidad) };
    if (form.descuento_porcentaje) cuerpo.descuento_porcentaje = Number(form.descuento_porcentaje);
    hacer(async () => { await api('POST', `/ventas/${id}/lineas`, cuerpo); setForm(VACIA); });
  };
  const quitar = (l) => hacer(() => api('DELETE', `/ventas/${id}/lineas/${l.id}`));
  const confirmar = () => {
    if (!window.confirm(t('ventaDetalle.confirmConfirmar'))) return;
    hacer(() => api('POST', `/ventas/${id}/confirmar`), t('ventaDetalle.confirmada'));
  };
  const borrar = async () => {
    if (!window.confirm(t('ventaDetalle.confirmBorrar'))) return;
    try { await api('DELETE', `/ventas/${id}`); navegar('/ventas'); } catch (e) { setError(e.message); }
  };
  const pagar = (e) => {
    e.preventDefault();
    const cuerpo = { metodo: pago.metodo, monto: Number(pago.monto) };
    if (pago.referencia.trim()) cuerpo.referencia = pago.referencia.trim();
    hacer(async () => { await api('POST', `/ventas/${id}/pagos`, cuerpo); setPago(PAGO); }, t('ventaDetalle.pagoRegistrado'));
  };

  async function crearNota() {
    const m = window.prompt(t('ventaDetalle.motivoNota'));
    if (!m || !m.trim()) return;
    setError(''); setAviso('');
    try {
      const n = await api('POST', '/notas-credito', { venta_id: Number(id), motivo: m.trim() });
      navegar('/notas-credito/' + n.id);
    } catch (e) { setError(e.message); }
  }

  if (!v) return <>{error ? <p className="error">{error}</p> : <p className="suave">{t('comun.cargando')}</p>}</>;
  const borrador = v.estado === 'borrador';
  const confirmada = v.estado === 'confirmada';

  return (
    <>
      <p><Link to="/ventas">← {t('menu.ventas')}</Link></p>
      <h2>{t('ventaDetalle.venta')} {v.numero} <span className={`etiqueta ${CLASE[v.estado]}`}>{t('estados.' + v.estado, { defaultValue: v.estado })}</span></h2>
      <p className="suave">{v.cliente ?? t('ventas.consumidorFinal')} · {fecha(v.fecha)}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })} required>
            <option value="">{t('ventaDetalle.productoOpcion')}</option>
            {productos.map((p) => {
              const sinPrecio = p.precio_venta === null;
              const disp = stock[p.id] ?? 0;
              const nota = sinPrecio ? ' · ' + t('ventaDetalle.sinPrecio')
                : disp <= 0 ? ' · ' + t('ventaDetalle.sinStock')
                : ' · ' + pesos(p.precio_venta) + ' · ' + t('ventaDetalle.disp') + ' ' + num(disp);
              return <option key={p.id} value={p.id} disabled={sinPrecio || disp <= 0}>{p.codigo} · {p.nombre}{nota}</option>;
            })}
          </select>
          <input type="number" min="0" step="any" placeholder={t('ventaDetalle.cantidad')} value={form.cantidad}
                 onChange={(e) => setForm({ ...form, cantidad: e.target.value })} required />
          <input type="number" min="0" max="100" step="any" placeholder={t('ventaDetalle.descuentoPh')}
                 value={form.descuento_porcentaje}
                 onChange={(e) => setForm({ ...form, descuento_porcentaje: e.target.value })} />
          <button>{t('ventaDetalle.agregar')}</button>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('ventaDetalle.thCodigo')}</th><th>{t('ventaDetalle.thProducto')}</th><th className="num">{t('ventaDetalle.thCant')}</th><th className="num">{t('ventaDetalle.thPrecio')}</th>
                <th className="num">{t('ventaDetalle.thDesc')}</th><th className="num">{t('ventaDetalle.iva')}</th><th className="num">{t('comun.total')}</th>{borrador && <th />}</tr>
          </thead>
          <tbody>
            {v.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.codigo}</td><td>{l.nombre}</td><td className="num">{num(l.cantidad)}</td>
                <td className="num">{pesos(l.precio_unitario)}</td>
                <td className="num">{Number(l.descuento_porcentaje)}%</td>
                <td className="num">{Number(l.impuesto_porcentaje)}%</td>
                <td className="num">{pesos(l.total)}</td>
                {borrador && <td><button className="secundario" onClick={() => quitar(l)}>{t('ventaDetalle.quitar')}</button></td>}
              </tr>
            ))}
            {v.lineas.length === 0 && <tr><td colSpan="8" className="vacio">{t('ventaDetalle.sinProductos')}</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan="6" className="num">{t('ventaDetalle.subtotal')}</td><td className="num">{pesos(v.subtotal)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num">{t('ventaDetalle.iva')}</td><td className="num">{pesos(v.impuesto)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num"><strong>{t('comun.total')}</strong></td><td className="num"><strong>{pesos(v.total)}</strong></td>{borrador && <td />}</tr>
            {confirmada && <tr><td colSpan="6" className="num">{t('ventaDetalle.pagado')}</td><td className="num">{pesos(v.pagado_neto)}</td></tr>}
            {confirmada && <tr><td colSpan="6" className="num"><strong>{t('ventaDetalle.saldo')}</strong></td><td className="num"><strong>{pesos(v.saldo)}</strong></td></tr>}
          </tfoot>
        </table>
      </div>

      {borrador && (
        <div className="acciones">
          <button onClick={confirmar} disabled={v.lineas.length === 0}>{t('ventaDetalle.confirmarBtn')}</button>
          <button className="secundario" onClick={borrar}>{t('ventaDetalle.borrarBtn')}</button>
        </div>
      )}

      {confirmada && (
        <>
          <div className="acciones">
            <button className="secundario" onClick={crearNota}>{t('ventaDetalle.crearNota')}</button>
          </div>
          <h3>{t('ventaDetalle.pagos')}</h3>
          {v.pagos.length > 0 && (
            <div className="tabla-caja">
              <table>
                <thead><tr><th>{t('comun.fecha')}</th><th>{t('ventaDetalle.thTipo')}</th><th>{t('ventaDetalle.thMetodo')}</th><th>{t('ventaDetalle.thReferencia')}</th><th className="num">{t('ventaDetalle.thMonto')}</th></tr></thead>
                <tbody>
                  {v.pagos.map((p) => (
                    <tr key={p.id}><td>{fecha(p.fecha)}</td><td>{t('tiposPago.' + p.tipo, { defaultValue: p.tipo })}</td><td>{t('metodos.' + p.metodo, { defaultValue: p.metodo })}</td>
                        <td>{p.referencia ?? '—'}</td><td className="num">{pesos(p.monto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Number(v.saldo) > 0 && (
            <form className="formulario" onSubmit={pagar}>
              <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
                <option value="efectivo">{t('metodos.efectivo')}</option>
                <option value="transferencia">{t('metodos.transferencia')}</option>
                <option value="tarjeta">{t('metodos.tarjeta')}</option>
                <option value="otro">{t('metodos.otro')}</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder={t('ventaDetalle.monto', { saldo: pesos(v.saldo) })}
                     value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} required />
              <input placeholder={t('ventaDetalle.referenciaPh')} value={pago.referencia}
                     onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
              <button>{t('ventaDetalle.registrarPago')}</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
