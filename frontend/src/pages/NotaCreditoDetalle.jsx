import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';

const CLASE = { borrador: 'neutra', confirmada: 'buena' };
const REEMBOLSO = { metodo: 'efectivo', monto: '', referencia: '' };

export default function NotaCreditoDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
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
    if (!window.confirm('¿Confirmar la nota crédito? Ya no se podrán cambiar las líneas.')) return;
    hacer(() => api('POST', `/notas-credito/${id}/confirmar`), 'Nota crédito confirmada');
  };
  const borrar = async () => {
    if (!window.confirm('¿Borrar este borrador?')) return;
    try { await api('DELETE', `/notas-credito/${id}`); navegar('/notas-credito'); } catch (e) { setError(e.message); }
  };
  const reingresar = (l) => hacer(
    () => api('POST', `/notas-credito/${id}/reingresos`,
      { nota_credito_detalle_id: l.id, cantidad: Number(reingreso[l.id]) }),
    'Reingreso al stock registrado');
  const reembolsar = (e) => {
    e.preventDefault();
    const cuerpo = { metodo: reembolso.metodo, monto: Number(reembolso.monto) };
    if (reembolso.referencia.trim()) cuerpo.referencia = reembolso.referencia.trim();
    hacer(async () => { await api('POST', `/notas-credito/${id}/reembolsos`, cuerpo); setReembolso(REEMBOLSO); },
      'Reembolso registrado');
  };

  if (!n || !venta) return <>{error ? <p className="error">{error}</p> : <p className="suave">Cargando…</p>}</>;
  const borrador = n.estado === 'borrador';
  const porLinea = Object.fromEntries(venta.lineas.map((l) => [l.id, l]));
  const aFavor = Number(venta.saldo) < 0 ? -Number(venta.saldo) : 0;

  return (
    <>
      <p><Link to="/notas-credito">← Notas crédito</Link> · <Link to={`/ventas/${n.venta_id}`}>Venta {venta.numero}</Link></p>
      <h2>Nota crédito {n.numero} <span className={`etiqueta ${CLASE[n.estado]}`}>{n.estado}</span></h2>
      <p className="suave">{fecha(n.fecha)} · Motivo: {n.motivo}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={linea.venta_detalle_id} onChange={(e) => setLinea({ ...linea, venta_detalle_id: e.target.value })} required>
            <option value="">Producto de la venta…</option>
            {venta.lineas.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre} · vendidas {num(l.cantidad)}</option>)}
          </select>
          <input type="number" min="0" step="any" placeholder="Cantidad a devolver" value={linea.cantidad}
                 onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })} required />
          <button>Agregar</button>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Producto</th><th className="num">Cantidad</th><th className="num">Total</th>
                {!borrador && <th className="num">Reingresado</th>}{!borrador && <th>Reingresar al stock</th>}{borrador && <th />}</tr>
          </thead>
          <tbody>
            {n.lineas.map((l) => {
              const v = porLinea[l.venta_detalle_id];
              const pendiente = Number(l.cantidad) - Number(l.reingresado);
              return (
                <tr key={l.id}>
                  <td>{v ? `${v.codigo} · ${v.nombre}` : `Línea ${l.venta_detalle_id}`}</td>
                  <td className="num">{num(l.cantidad)}</td>
                  <td className="num">{pesos(l.total)}</td>
                  {!borrador && <td className="num">{num(l.reingresado)} de {num(l.cantidad)}</td>}
                  {!borrador && (
                    <td>
                      {pendiente > 0 ? (
                        <span className="fila-acciones">
                          <input type="number" min="0" step="any" max={pendiente} placeholder={`hasta ${num(pendiente)}`}
                                 value={reingreso[l.id] ?? ''} className="precio"
                                 onChange={(e) => setReingreso({ ...reingreso, [l.id]: e.target.value })} />
                          <button className="secundario" onClick={() => reingresar(l)}>Reingresar</button>
                        </span>
                      ) : <span className="suave">Completo</span>}
                    </td>
                  )}
                  {borrador && <td><button className="secundario" onClick={() => quitar(l)}>Quitar</button></td>}
                </tr>
              );
            })}
            {n.lineas.length === 0 && <tr><td colSpan="5" className="vacio">Sin líneas todavía</td></tr>}
          </tbody>
          <tfoot>
            <tr><td className="num">Subtotal</td><td /><td className="num">{pesos(n.subtotal)}</td><td colSpan="2" /></tr>
            <tr><td className="num">IVA</td><td /><td className="num">{pesos(n.impuesto)}</td><td colSpan="2" /></tr>
            <tr><td className="num"><strong>Total a favor del cliente</strong></td><td /><td className="num"><strong>{pesos(n.total)}</strong></td><td colSpan="2" /></tr>
          </tfoot>
        </table>
      </div>

      {borrador && (
        <div className="acciones">
          <button onClick={confirmar} disabled={n.lineas.length === 0}>Confirmar nota crédito</button>
          <button className="secundario" onClick={borrar}>Borrar borrador</button>
        </div>
      )}

      {!borrador && (
        <>
          <h3>Reembolsos</h3>
          <p className="suave">
            Reingresar al stock es solo para lo que vuelve en buen estado. El dinero se devuelve aparte.{' '}
            {aFavor > 0 ? `Pendiente por devolver al cliente: ${pesos(aFavor)}.` : 'No hay dinero pendiente por devolver.'}
          </p>
          {n.reembolsos.length > 0 && (
            <div className="tabla-caja">
              <table>
                <thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {n.reembolsos.map((r) => (
                    <tr key={r.id}><td>{fecha(r.fecha)}</td><td>{r.metodo}</td><td>{r.referencia ?? '—'}</td>
                        <td className="num">{pesos(r.monto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {aFavor > 0 && (
            <form className="formulario" onSubmit={reembolsar}>
              <select value={reembolso.metodo} onChange={(e) => setReembolso({ ...reembolso, metodo: e.target.value })}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder="Monto" value={reembolso.monto}
                     onChange={(e) => setReembolso({ ...reembolso, monto: e.target.value })} required />
              <input placeholder="Referencia (opcional)" value={reembolso.referencia}
                     onChange={(e) => setReembolso({ ...reembolso, referencia: e.target.value })} />
              <button>Registrar reembolso</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
