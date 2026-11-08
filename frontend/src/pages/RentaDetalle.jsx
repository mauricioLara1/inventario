import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fechaHora } from '../formato';
import Campo from '../Campo';

const CLASE = { abierta: 'neutra', cerrada: 'buena', cancelada: 'mala' };
const CLASE_PIEZA = { pendiente: 'neutra', devuelta: 'buena', danada: 'mala', perdida: 'mala' };
const TIPOS = {
  cobro: { titulo: 'Cobrar al cliente', texto: 'El cliente paga dinero por lo que debe. Entra dinero a la caja.' },
  aplicacion_deposito: { titulo: 'Usar el depósito para pagar', texto: 'No entra dinero nuevo: lo que debe el cliente se paga con el depósito que dejó.' },
  devolucion_deposito: { titulo: 'Devolver depósito al cliente', texto: 'Se le entrega al cliente el depósito que sobra. Sale dinero de la caja.' },
};
const MOV = {
  cobro: ['Cobro al cliente', 'Entra a caja'],
  aplicacion_deposito: ['Depósito usado para pagar', 'Sin movimiento de caja'],
  devolucion_deposito: ['Depósito devuelto al cliente', 'Sale de caja'],
};
const PAGO = { tipo: 'cobro', metodo: 'efectivo', monto: '', referencia: '' };
const CARGO = { renta_detalle_id: '', concepto_cargo_id: '', monto: '', descripcion: '' };
const redondo = (x) => Number(Number(x).toFixed(2));

const Info = ({ texto }) => (
  <span className="ayuda" tabIndex={0}>i<span className="globo" role="tooltip">{texto}</span></span>
);
const Dato = ({ etiqueta, ayuda, valor, fuerte }) => (
  <div className={fuerte ? 'fuerte' : ''}>
    <span>{etiqueta}{ayuda && <Info texto={ayuda} />}</span>
    <strong>{valor}</strong>
  </div>
);

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
    const cuerpo = { tipo: pago.tipo, metodo: pago.tipo === 'aplicacion_deposito' ? 'otro' : pago.metodo, monto: Number(pago.monto) };
    if (pago.referencia.trim()) cuerpo.referencia = pago.referencia.trim();
    hacer(async () => { await api('POST', `/rentas/${id}/pagos`, cuerpo); setPago({ ...PAGO, tipo: pago.tipo }); },
      `${TIPOS[pago.tipo].titulo}: registrado`);
  };
  const cerrar = () => {
    if (!window.confirm('¿Cerrar la renta? Ya no se podrá modificar.')) return;
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

  let guia = null;
  if (abierta) {
    if (pendientes.length > 0) {
      guia = ['info', `Faltan ${pendientes.length} pieza(s) por devolver. Registra cómo regresó cada una en la tabla de piezas.`];
    } else if (saldo > 0) {
      guia = ['aviso', `El cliente debe ${pesos(saldo)}. ` + (poder > 0
        ? `Puedes usar su depósito (${pesos(poder)}) para pagarlo${saldo > poder ? ' y cobrar el resto.' : '.'}`
        : 'Cóbraselo.')];
    } else if (poder > 0) {
      guia = ['aviso', `La cuenta está saldada. Falta devolverle al cliente su depósito: ${pesos(poder)}.`];
    } else {
      guia = ['ok', 'Todo está saldado y el depósito quedó en cero. Ya puedes cerrar la renta.'];
    }
  }

  const sugerencias = [];
  if (abierta && pendientes.length === 0) {
    if (saldo > 0 && poder > 0) {
      const m = redondo(Math.min(saldo, poder));
      sugerencias.push({ texto: `Usar depósito: ${pesos(m)}`, tipo: 'aplicacion_deposito', monto: m });
    }
    if (saldo > poder) {
      const m = redondo(saldo - poder);
      sugerencias.push({ texto: `Cobrar: ${pesos(m)}`, tipo: 'cobro', monto: m });
    }
    if (saldo <= 0 && poder > 0) {
      sugerencias.push({ texto: `Devolver depósito: ${pesos(poder)}`, tipo: 'devolucion_deposito', monto: redondo(poder) });
    }
  }
  const maximo = Math.max(0, pago.tipo === 'cobro' ? saldo : pago.tipo === 'aplicacion_deposito' ? Math.min(saldo, poder) : poder);
  const requisitos = [
    [pendientes.length === 0, 'Todas las piezas devueltas'],
    [saldo <= 0, 'Sin saldo por cobrar'],
    [poder <= 0, 'Depósito devuelto o usado (no queda nada en poder)'],
  ];

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
      {guia && <p className={`guia ${guia[0]}`}>{guia[1]}</p>}

      <h3>Cuenta</h3>
      <div className="resumen">
        <Dato etiqueta="Piezas (tiempo rentado)" ayuda="Lo que suman las piezas ya devueltas, según los periodos usados y su tarifa." valor={pesos(c.total_piezas)} />
        <Dato etiqueta="Cargos extra" ayuda="Cobros adicionales por daños, retrasos, limpieza, etc." valor={pesos(c.total_cargos)} />
        <Dato etiqueta="Total a pagar" ayuda="Piezas más cargos extra." valor={pesos(c.consumo)} fuerte />
        <Dato etiqueta="Pagado en dinero" ayuda="Lo que el cliente ha pagado directamente (efectivo, transferencia, tarjeta…)." valor={pesos(c.cobrado)} />
        <Dato etiqueta="Pagado con depósito" ayuda="Parte de la cuenta que se pagó usando el depósito que el cliente dejó." valor={pesos(c.deposito_aplicado)} />
        <Dato etiqueta="Saldo por cobrar" ayuda="Lo que el cliente todavía debe. Debe quedar en 0 para cerrar." valor={pesos(c.saldo)} fuerte />
      </div>

      <h3>Depósito</h3>
      <div className="resumen">
        <Dato etiqueta="Recibido" ayuda="Depósito que el cliente dejó al abrir la renta." valor={pesos(c.deposito_cobrado)} />
        <Dato etiqueta="Usado para pagar" ayuda="Parte del depósito que se descontó de lo que debía." valor={pesos(c.deposito_aplicado)} />
        <Dato etiqueta="Devuelto al cliente" ayuda="Depósito que ya se le entregó de vuelta." valor={pesos(c.deposito_devuelto)} />
        <Dato etiqueta="Aún en tu poder" ayuda="Depósito que todavía tienes y debes devolver o usar para pagar. Debe quedar en 0 para cerrar." valor={pesos(c.deposito_en_poder)} fuerte />
      </div>

      <h3>Piezas</h3>
      {abierta && <p className="suave">Registra cómo regresó cada pieza: en buen estado vuelve a estar disponible; dañada pasa a mantenimiento; perdida se retira.</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Pieza</th><th>Producto</th><th className="num">Tarifa</th><th>Estado</th>
                <th className="num">Periodos</th><th className="num">Total</th>{abierta && <th>Registrar devolución</th>}</tr>
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
                          <option value="devuelta">Devuelta en buen estado</option>
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

      <h3>Cargos extra</h3>
      <p className="suave">Cobros adicionales por daños, retrasos, limpieza… Se suman al total a pagar.</p>
      {r.cargos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Motivo</th><th>Pieza</th><th>Detalle</th><th className="num">Monto</th></tr></thead>
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
          <Campo etiqueta="Pieza" ayuda="La pieza a la que corresponde el cargo.">
            <select value={cargo.renta_detalle_id} onChange={(e) => setCargo({ ...cargo, renta_detalle_id: e.target.value })} required>
              <option value="">Elegir…</option>
              {r.lineas.map((l) => <option key={l.id} value={l.id}>{l.unidad} · {l.producto}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Motivo del cargo" ayuda="Tipo de cargo: daño, retraso, limpieza… Se administran en el catálogo de renta.">
            <select value={cargo.concepto_cargo_id} onChange={(e) => setCargo({ ...cargo, concepto_cargo_id: e.target.value })} required>
              <option value="">Elegir…</option>
              {conceptos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Monto" ayuda="Valor extra que se suma al total a pagar, además del tiempo rentado.">
            <input type="number" min="0" step="0.01" placeholder="Ej. 15000" value={cargo.monto}
                   onChange={(e) => setCargo({ ...cargo, monto: e.target.value })} required />
          </Campo>
          <Campo etiqueta="Detalle (opcional)">
            <input placeholder="Ej. Mango roto" value={cargo.descripcion}
                   onChange={(e) => setCargo({ ...cargo, descripcion: e.target.value })} />
          </Campo>
          <button className="secundario">Agregar cargo</button>
        </form>
      )}

      <h3>Movimientos de dinero</h3>
      {r.pagos.length > 0 ? (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Fecha</th><th>Qué pasó</th><th>Caja</th><th>Método</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {r.pagos.map((p) => (
                <tr key={p.id}><td>{fechaHora(p.fecha)}</td><td>{MOV[p.tipo]?.[0] ?? p.tipo}</td>
                    <td><span className="suave">{MOV[p.tipo]?.[1] ?? ''}</span></td>
                    <td>{p.tipo === 'aplicacion_deposito' ? '—' : p.metodo}</td>
                    <td>{p.referencia ?? '—'}</td><td className="num">{pesos(p.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="suave">Todavía no hay movimientos.</p>}

      {abierta && (
        <>
          <h3>Registrar un movimiento</h3>
          <div className="segmentos">
            {Object.entries(TIPOS).map(([k, v]) => (
              <button type="button" key={k} className={`segmento ${pago.tipo === k ? 'activo' : ''}`}
                      onClick={() => setPago({ ...pago, tipo: k })}>{v.titulo}</button>
            ))}
          </div>
          <p className="suave">{TIPOS[pago.tipo].texto}</p>
          {sugerencias.length > 0 && (
            <p className="suave">Sugerido: {sugerencias.map((s) => (
              <button key={s.texto} type="button" className="secundario"
                      onClick={() => setPago({ ...pago, tipo: s.tipo, monto: String(s.monto) })}>{s.texto}</button>
            ))}</p>
          )}
          <form className="formulario" onSubmit={registrarPago}>
            {pago.tipo !== 'aplicacion_deposito' && (
              <Campo etiqueta="Método" ayuda="Cómo se recibe o se entrega el dinero.">
                <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </Campo>
            )}
            <Campo etiqueta="Monto" ayuda="Valor de este movimiento. No puede superar el máximo que se muestra.">
              <input type="number" min="0" step="0.01" placeholder={`Hasta ${pesos(maximo)}`} value={pago.monto}
                     onChange={(e) => setPago({ ...pago, monto: e.target.value })} required />
            </Campo>
            <Campo etiqueta="Referencia (opcional)" ayuda="Número de transferencia, voucher o nota para identificar el movimiento.">
              <input placeholder="Ej. 123456" value={pago.referencia}
                     onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
            </Campo>
            <button>{TIPOS[pago.tipo].titulo}</button>
          </form>

          <h3>Cerrar la renta</h3>
          <ul className="chequeo">
            {requisitos.map(([ok, texto]) => <li key={texto} className={ok ? 'cumple' : 'falta'}>{ok ? '✔' : '✗'} {texto}</li>)}
          </ul>
          <div className="acciones">
            <button onClick={cerrar} disabled={!requisitos.every(([ok]) => ok)}>Cerrar renta</button>
            <button className="secundario" onClick={cancelar}>Cancelar renta</button>
            <span className="suave">Cancelar solo es posible si no se ha devuelto ninguna pieza.</span>
          </div>
        </>
      )}
    </>
  );
}
