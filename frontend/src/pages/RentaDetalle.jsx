import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fechaHora } from '../formato';

const CLASE = { abierta: 'neutra', cerrada: 'buena', cancelada: 'mala' };
const CLASE_PIEZA = { pendiente: 'neutra', devuelta: 'buena', danada: 'mala', perdida: 'mala' };
const TIPOS = { cobro: 'Cobro al cliente', aplicacion_deposito: 'Aplicar depósito al saldo', devolucion_deposito: 'Devolver depósito' };
const PAGO = { tipo: 'cobro', metodo: 'efectivo', monto: '', referencia: '' };
const CARGO = { renta_detalle_id: '', concepto_cargo_id: '', monto: '', descripcion: '' };
const redondo = (x) => Number(Number(x).toFixed(2));

export default function RentaDetalle() {
  const { id } = useParams();
  const [r, setR] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [conceptos, setConceptos] = useState([]);
  const [estadoPieza, setEstadoPieza] = useState({});
  const [pago, setPago] = useState(PAGO);
  const [cargo, setCargo] = useState(CARGO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const renta = await api('GET', `/rentas/${id}`);
      setR(renta);
      setCliente(await api('GET', `/clientes/${renta.cliente_id}`));
      setConceptos(await api('GET', '/renta-catalogo/conceptos'));
      setError('');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); if (mensaje) setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }

  const devolver = (l) => hacer(
    () => api('POST', `/rentas/${id}/devolver`, { renta_detalle_id: l.id, estado: estadoPieza[l.id] ?? 'devuelta' }),
    `Pieza ${l.unidad} registrada`);
  const agregarCargo = (e) => {
    e.preventDefault();
    const cuerpo = { renta_detalle_id: Number(cargo.renta_detalle_id), concepto_cargo_id: Number(cargo.concepto_cargo_id),
                     monto: Number(cargo.monto) };
    if (cargo.descripcion.trim()) cuerpo.descripcion = cargo.descripcion.trim();
    hacer(async () => { await api('POST', `/rentas/${id}/cargos`, cuerpo); setCargo(CARGO); }, 'Cargo agregado');
  };
  const registrarPago = (e) => {
    e.preventDefault();
    const cuerpo = { tipo: pago.tipo, metodo: pago.metodo, monto: Number(pago.monto) };
    if (pago.referencia.trim()) cuerpo.referencia = pago.referencia.trim();
    hacer(async () => { await api('POST', `/rentas/${id}/pagos`, cuerpo); setPago(PAGO); }, 'Pago registrado');
  };
  const cerrar = () => {
    if (!window.confirm('¿Cerrar la renta? Debe estar todo devuelto, con saldo en 0 y sin depósito en poder.')) return;
    hacer(() => api('POST', `/rentas/${id}/cerrar`), 'Renta cerrada');
  };
  const cancelar = () => {
    if (!window.confirm('¿Cancelar la renta? Solo se puede si no se ha devuelto ninguna pieza.')) return;
    hacer(() => api('POST', `/rentas/${id}/cancelar`), 'Renta cancelada');
  };

  if (!r) return <>{error ? <p className="error">{error}</p> : <p className="suave">Cargando…</p>}</>;
  const c = r.cuenta;
  const abierta = r.estado === 'abierta';
  const pendientes = r.lineas.filter((l) => l.estado_devolucion === 'pendiente');
  const saldo = Number(c.saldo);
  const poder = Number(c.deposito_en_poder);

  const sugerencias = [];
  if (abierta && pendientes.length === 0) {
    if (saldo > 0 && poder > 0) {
      const m = redondo(Math.min(saldo, poder));
      sugerencias.push({ texto: `Aplicar depósito ${pesos(m)}`, tipo: 'aplicacion_deposito', monto: m });
    }
    if (saldo > poder) {
      const m = redondo(saldo - poder);
      sugerencias.push({ texto: `Cobrar ${pesos(m)}`, tipo: 'cobro', monto: m });
    }
    if (saldo <= 0 && poder > 0) {
      sugerencias.push({ texto: `Devolver depósito ${pesos(poder)}`, tipo: 'devolucion_deposito', monto: redondo(poder) });
    }
  }

  return (
    <>
      <p><Link to="/rentas">← Rentas</Link></p>
      <h2>Renta {r.numero} <span className={`etiqueta ${CLASE[r.estado]}`}>{r.estado}</span></h2>
      <p className="suave">
        {cliente ? `${cliente.nombre}${cliente.telefono ? ' · ' + cliente.telefono : ''}` : ''} · desde {fechaHora(r.fecha_inicio)} ·
        devolución prevista {fechaHora(r.fecha_prevista_devolucion)}{r.fecha_cierre ? ` · cerrada ${fechaHora(r.fecha_cierre)}` : ''}
      </p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <div className="resumen">
        <div><span>Consumo</span><strong>{pesos(c.consumo)}</strong></div>
        <div><span>Cobrado</span><strong>{pesos(c.cobrado)}</strong></div>
        <div><span>Depósito en poder</span><strong>{pesos(c.deposito_en_poder)}</strong></div>
        <div><span>Saldo por cobrar</span><strong>{pesos(c.saldo)}</strong></div>
      </div>

      <h3>Piezas</h3>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Pieza</th><th>Producto</th><th className="num">Tarifa</th><th>Estado</th>
                <th className="num">Periodos</th><th className="num">Total</th>{abierta && <th />}</tr>
          </thead>
          <tbody>
            {r.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.unidad}</td><td>{l.producto}</td><td className="num">{pesos(l.tarifa_aplicada)}</td>
                <td><span className={`etiqueta ${CLASE_PIEZA[l.estado_devolucion]}`}>{l.estado_devolucion}</span></td>
                <td className="num">{l.periodos_cobrados === null ? '—' : num(l.periodos_cobrados)}</td>
                <td className="num">{l.estado_devolucion === 'pendiente' ? '—' : pesos(l.total)}</td>
                {abierta && (
                  <td>
                    {l.estado_devolucion === 'pendiente' && (
                      <span className="fila-acciones">
                        <select value={estadoPieza[l.id] ?? 'devuelta'}
                                onChange={(e) => setEstadoPieza({ ...estadoPieza, [l.id]: e.target.value })}>
                          <option value="devuelta">Devuelta bien</option>
                          <option value="danada">Dañada</option>
                          <option value="perdida">Perdida</option>
                        </select>
                        <button className="secundario" onClick={() => devolver(l)}>Registrar</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(r.cargos.length > 0 || abierta) && <h3>Cargos extra</h3>}
      {r.cargos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Concepto</th><th>Pieza</th><th>Descripción</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {r.cargos.map((k) => (
                <tr key={k.id}><td>{k.concepto}</td>
                    <td>{r.lineas.find((l) => l.id === k.renta_detalle_id)?.unidad ?? ''}</td>
                    <td>{k.descripcion ?? '—'}</td><td className="num">{pesos(k.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abierta && (
        <form className="formulario" onSubmit={agregarCargo}>
          <select value={cargo.renta_detalle_id} onChange={(e) => setCargo({ ...cargo, renta_detalle_id: e.target.value })} required>
            <option value="">Pieza…</option>
            {r.lineas.map((l) => <option key={l.id} value={l.id}>{l.unidad} · {l.producto}</option>)}
          </select>
          <select value={cargo.concepto_cargo_id} onChange={(e) => setCargo({ ...cargo, concepto_cargo_id: e.target.value })} required>
            <option value="">Concepto…</option>
            {conceptos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
          </select>
          <input type="number" min="0" step="0.01" placeholder="Monto" value={cargo.monto}
                 onChange={(e) => setCargo({ ...cargo, monto: e.target.value })} required />
          <input placeholder="Descripción (opcional)" value={cargo.descripcion}
                 onChange={(e) => setCargo({ ...cargo, descripcion: e.target.value })} />
          <button className="secundario">Agregar cargo</button>
        </form>
      )}

      <h3>Pagos y depósito</h3>
      {r.pagos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Método</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {r.pagos.map((p) => (
                <tr key={p.id}><td>{fechaHora(p.fecha)}</td><td>{TIPOS[p.tipo] ?? p.tipo}</td><td>{p.metodo}</td>
                    <td>{p.referencia ?? '—'}</td><td className="num">{pesos(p.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abierta && (
        <>
          {sugerencias.length > 0 && (
            <p className="suave">Sugerido: {sugerencias.map((s) => (
              <button key={s.texto} type="button" className="secundario"
                      onClick={() => setPago({ ...pago, tipo: s.tipo, monto: String(s.monto) })}>{s.texto}</button>
            ))}</p>
          )}
          <form className="formulario" onSubmit={registrarPago}>
            <select value={pago.tipo} onChange={(e) => setPago({ ...pago, tipo: e.target.value })}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
            <input type="number" min="0" step="0.01" placeholder="Monto" value={pago.monto}
                   onChange={(e) => setPago({ ...pago, monto: e.target.value })} required />
            <input placeholder="Referencia (opcional)" value={pago.referencia}
                   onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
            <button>Registrar</button>
          </form>
          <div className="acciones">
            <button onClick={cerrar} disabled={pendientes.length > 0}>Cerrar renta</button>
            <button className="secundario" onClick={cancelar}>Cancelar renta</button>
            {pendientes.length > 0 && <span className="suave">Faltan {pendientes.length} pieza(s) por devolver</span>}
          </div>
        </>
      )}
    </>
  );
}
