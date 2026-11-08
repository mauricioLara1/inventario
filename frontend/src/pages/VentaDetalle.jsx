import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';

const CLASE = { borrador: 'neutra', confirmada: 'buena', anulada: 'mala' };
const VACIA = { producto_id: '', cantidad: '', descuento_porcentaje: '' };
const PAGO = { metodo: 'efectivo', monto: '', referencia: '' };

export default function VentaDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
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
    if (!window.confirm('¿Confirmar la venta? Sale el stock y ya no se podrán cambiar las líneas.')) return;
    hacer(() => api('POST', `/ventas/${id}/confirmar`), 'Venta confirmada');
  };
  const borrar = async () => {
    if (!window.confirm('¿Borrar este borrador?')) return;
    try { await api('DELETE', `/ventas/${id}`); navegar('/ventas'); } catch (e) { setError(e.message); }
  };
  const pagar = (e) => {
    e.preventDefault();
    const cuerpo = { metodo: pago.metodo, monto: Number(pago.monto) };
    if (pago.referencia.trim()) cuerpo.referencia = pago.referencia.trim();
    hacer(async () => { await api('POST', `/ventas/${id}/pagos`, cuerpo); setPago(PAGO); }, 'Pago registrado');
  };

  async function crearNota() {
    const m = window.prompt('Motivo de la nota crédito (devolución):');
    if (!m || !m.trim()) return;
    setError(''); setAviso('');
    try {
      const n = await api('POST', '/notas-credito', { venta_id: Number(id), motivo: m.trim() });
      navegar('/notas-credito/' + n.id);
    } catch (e) { setError(e.message); }
  }

  if (!v) return <>{error ? <p className="error">{error}</p> : <p className="suave">Cargando…</p>}</>;
  const borrador = v.estado === 'borrador';
  const confirmada = v.estado === 'confirmada';

  return (
    <>
      <p><Link to="/ventas">← Ventas</Link></p>
      <h2>Venta {v.numero} <span className={`etiqueta ${CLASE[v.estado]}`}>{v.estado}</span></h2>
      <p className="suave">{v.cliente ?? 'Consumidor final'} · {fecha(v.fecha)}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })} required>
            <option value="">Producto…</option>
            {productos.map((p) => {
              const sinPrecio = p.precio_venta === null;
              const disp = stock[p.id] ?? 0;
              const nota = sinPrecio ? ' · sin precio (ponlo en Catálogo)'
                : disp <= 0 ? ' · sin stock'
                : ' · ' + pesos(p.precio_venta) + ' · disp. ' + num(disp);
              return <option key={p.id} value={p.id} disabled={sinPrecio || disp <= 0}>{p.codigo} · {p.nombre}{nota}</option>;
            })}
          </select>
          <input type="number" min="0" step="any" placeholder="Cantidad" value={form.cantidad}
                 onChange={(e) => setForm({ ...form, cantidad: e.target.value })} required />
          <input type="number" min="0" max="100" step="any" placeholder="Descuento % (opcional)"
                 value={form.descuento_porcentaje}
                 onChange={(e) => setForm({ ...form, descuento_porcentaje: e.target.value })} />
          <button>Agregar</button>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Código</th><th>Producto</th><th className="num">Cant.</th><th className="num">Precio</th>
                <th className="num">Desc.</th><th className="num">IVA</th><th className="num">Total</th>{borrador && <th />}</tr>
          </thead>
          <tbody>
            {v.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.codigo}</td><td>{l.nombre}</td><td className="num">{num(l.cantidad)}</td>
                <td className="num">{pesos(l.precio_unitario)}</td>
                <td className="num">{Number(l.descuento_porcentaje)}%</td>
                <td className="num">{Number(l.impuesto_porcentaje)}%</td>
                <td className="num">{pesos(l.total)}</td>
                {borrador && <td><button className="secundario" onClick={() => quitar(l)}>Quitar</button></td>}
              </tr>
            ))}
            {v.lineas.length === 0 && <tr><td colSpan="8" className="vacio">Sin productos todavía</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan="6" className="num">Subtotal</td><td className="num">{pesos(v.subtotal)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num">IVA</td><td className="num">{pesos(v.impuesto)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num"><strong>Total</strong></td><td className="num"><strong>{pesos(v.total)}</strong></td>{borrador && <td />}</tr>
            {confirmada && <tr><td colSpan="6" className="num">Pagado</td><td className="num">{pesos(v.pagado_neto)}</td></tr>}
            {confirmada && <tr><td colSpan="6" className="num"><strong>Saldo</strong></td><td className="num"><strong>{pesos(v.saldo)}</strong></td></tr>}
          </tfoot>
        </table>
      </div>

      {borrador && (
        <div className="acciones">
          <button onClick={confirmar} disabled={v.lineas.length === 0}>Confirmar venta</button>
          <button className="secundario" onClick={borrar}>Borrar borrador</button>
        </div>
      )}

      {confirmada && (
        <>
          <div className="acciones">
            <button className="secundario" onClick={crearNota}>Crear nota crédito (devolución)</button>
          </div>
          <h3>Pagos</h3>
          {v.pagos.length > 0 && (
            <div className="tabla-caja">
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Método</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {v.pagos.map((p) => (
                    <tr key={p.id}><td>{fecha(p.fecha)}</td><td>{p.tipo}</td><td>{p.metodo}</td>
                        <td>{p.referencia ?? '—'}</td><td className="num">{pesos(p.monto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Number(v.saldo) > 0 && (
            <form className="formulario" onSubmit={pagar}>
              <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder={`Monto (saldo ${pesos(v.saldo)})`}
                     value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} required />
              <input placeholder="Referencia (opcional)" value={pago.referencia}
                     onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
              <button>Registrar pago</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
