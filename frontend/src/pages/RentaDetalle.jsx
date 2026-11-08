import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fechaHora } from '../formato';
import Campo from '../Campo';
import { useTranslation } from 'react-i18next';

const CLASE = { abierta: 'neutra', cerrada: 'buena', cancelada: 'mala' };
const CLASE_PIEZA = { pendiente: 'neutra', devuelta: 'buena', danada: 'mala', perdida: 'mala' };
const TIPOS = ['cobro', 'aplicacion_deposito', 'devolucion_deposito'];
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
  const { t } = useTranslation();
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
    t('rentaDetalle.piezaRegistrada', { unidad: l.unidad }));
  const agregarCargo = (e) => {
    e.preventDefault();
    const cuerpo = { renta_detalle_id: Number(cargo.renta_detalle_id), concepto_cargo_id: Number(cargo.concepto_cargo_id),
                     monto: Number(cargo.monto) };
    if (cargo.descripcion.trim()) cuerpo.descripcion = cargo.descripcion.trim();
    hacer(async () => { await api('POST', `/rentas/${id}/cargos`, cuerpo); setCargo(CARGO); }, t('rentaDetalle.cargoAgregado'));
  };
  const registrarPago = (e) => {
    e.preventDefault();
    const cuerpo = { tipo: pago.tipo, metodo: pago.tipo === 'aplicacion_deposito' ? 'otro' : pago.metodo, monto: Number(pago.monto) };
    if (pago.referencia.trim()) cuerpo.referencia = pago.referencia.trim();
    hacer(async () => { await api('POST', `/rentas/${id}/pagos`, cuerpo); setPago({ ...PAGO, tipo: pago.tipo }); },
      t('rentaDetalle.registrado', { titulo: t('rentaDetalle.tipo.' + pago.tipo + '.titulo') }));
  };
  const cerrar = () => {
    if (!window.confirm(t('rentaDetalle.confirmCerrar'))) return;
    hacer(() => api('POST', `/rentas/${id}/cerrar`), t('rentaDetalle.rentaCerrada'));
  };
  const cancelar = () => {
    if (!window.confirm(t('rentaDetalle.confirmCancelar'))) return;
    hacer(() => api('POST', `/rentas/${id}/cancelar`), t('rentaDetalle.rentaCancelada'));
  };

  if (!r) return <>{error ? <p className="error">{error}</p> : <p className="suave">{t('comun.cargando')}</p>}</>;
  const c = r.cuenta;
  const abierta = r.estado === 'abierta';
  const pendientes = r.lineas.filter((l) => l.estado_devolucion === 'pendiente');
  const saldo = Number(c.saldo);
  const poder = Number(c.deposito_en_poder);

  let guia = null;
  if (abierta) {
    if (pendientes.length > 0) {
      guia = ['info', t('rentaDetalle.guiaPendientes', { n: pendientes.length })];
    } else if (saldo > 0) {
      guia = ['aviso', t('rentaDetalle.guiaDebe', { valor: pesos(saldo) }) + ' ' + (poder > 0
        ? t(saldo > poder ? 'rentaDetalle.guiaUsarDepositoResto' : 'rentaDetalle.guiaUsarDepositoTodo', { valor: pesos(poder) })
        : t('rentaDetalle.guiaCobraselo'))];
    } else if (poder > 0) {
      guia = ['aviso', t('rentaDetalle.guiaSaldada', { valor: pesos(poder) })];
    } else {
      guia = ['ok', t('rentaDetalle.guiaListo')];
    }
  }

  const sugerencias = [];
  if (abierta && pendientes.length === 0) {
    if (saldo > 0 && poder > 0) {
      const m = redondo(Math.min(saldo, poder));
      sugerencias.push({ texto: t('rentaDetalle.sugUsar', { valor: pesos(m) }), tipo: 'aplicacion_deposito', monto: m });
    }
    if (saldo > poder) {
      const m = redondo(saldo - poder);
      sugerencias.push({ texto: t('rentaDetalle.sugCobrar', { valor: pesos(m) }), tipo: 'cobro', monto: m });
    }
    if (saldo <= 0 && poder > 0) {
      sugerencias.push({ texto: t('rentaDetalle.sugDevolver', { valor: pesos(poder) }), tipo: 'devolucion_deposito', monto: redondo(poder) });
    }
  }
  const maximo = Math.max(0, pago.tipo === 'cobro' ? saldo : pago.tipo === 'aplicacion_deposito' ? Math.min(saldo, poder) : poder);
  const requisitos = [
    [pendientes.length === 0, t('rentaDetalle.reqPiezas')],
    [saldo <= 0, t('rentaDetalle.reqSaldo')],
    [poder <= 0, t('rentaDetalle.reqDeposito')],
  ];

  return (
    <>
      <p><Link to="/rentas">← {t('menu.rentas')}</Link></p>
      <h2>{t('menu.rentas')} {r.numero} <span className={`etiqueta ${CLASE[r.estado]}`}>{t('estados.' + r.estado, { defaultValue: r.estado })}</span></h2>
      <p className="suave">
        {cliente ? `${cliente.nombre}${cliente.telefono ? ' · ' + cliente.telefono : ''}` : ''} · {t('rentaDetalle.desde')} {fechaHora(r.fecha_inicio)} ·
        {t('rentaDetalle.devolucionPrevista')} {fechaHora(r.fecha_prevista_devolucion)}{r.fecha_cierre ? ' · ' + t('rentaDetalle.cerrada') + ' ' + fechaHora(r.fecha_cierre) : ''}
      </p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      {guia && <p className={`guia ${guia[0]}`}>{guia[1]}</p>}

      <h3>{t('rentaDetalle.cuenta')}</h3>
      <div className="resumen">
        <Dato etiqueta={t('rentaDetalle.d.piezas')} ayuda={t('rentaDetalle.d.piezasAyuda')} valor={pesos(c.total_piezas)} />
        <Dato etiqueta={t('rentaDetalle.d.cargos')} ayuda={t('rentaDetalle.d.cargosAyuda')} valor={pesos(c.total_cargos)} />
        <Dato etiqueta={t('rentaDetalle.d.total')} ayuda={t('rentaDetalle.d.totalAyuda')} valor={pesos(c.consumo)} fuerte />
        <Dato etiqueta={t('rentaDetalle.d.pagadoDinero')} ayuda={t('rentaDetalle.d.pagadoDineroAyuda')} valor={pesos(c.cobrado)} />
        <Dato etiqueta={t('rentaDetalle.d.pagadoDeposito')} ayuda={t('rentaDetalle.d.pagadoDepositoAyuda')} valor={pesos(c.deposito_aplicado)} />
        <Dato etiqueta={t('rentaDetalle.d.saldo')} ayuda={t('rentaDetalle.d.saldoAyuda')} valor={pesos(c.saldo)} fuerte />
      </div>

      <h3>{t('rentaDetalle.deposito')}</h3>
      <div className="resumen">
        <Dato etiqueta={t('rentaDetalle.d.recibido')} ayuda={t('rentaDetalle.d.recibidoAyuda')} valor={pesos(c.deposito_cobrado)} />
        <Dato etiqueta={t('rentaDetalle.d.usado')} ayuda={t('rentaDetalle.d.usadoAyuda')} valor={pesos(c.deposito_aplicado)} />
        <Dato etiqueta={t('rentaDetalle.d.devuelto')} ayuda={t('rentaDetalle.d.devueltoAyuda')} valor={pesos(c.deposito_devuelto)} />
        <Dato etiqueta={t('rentaDetalle.d.enPoder')} ayuda={t('rentaDetalle.d.enPoderAyuda')} valor={pesos(c.deposito_en_poder)} fuerte />
      </div>

      <h3>{t('rentaDetalle.piezas')}</h3>
      {abierta && <p className="suave">{t('rentaDetalle.notaPiezas')}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('rentaDetalle.thPieza')}</th><th>{t('rentaDetalle.thProducto')}</th><th className="num">{t('rentaDetalle.thTarifa')}</th><th>{t('comun.estado')}</th>
                <th className="num">{t('rentaDetalle.thPeriodos')}</th><th className="num">{t('comun.total')}</th>{abierta && <th>{t('rentaDetalle.thRegistrarDev')}</th>}</tr>
          </thead>
          <tbody>
            {r.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.unidad}</td><td>{l.producto}</td><td className="num">{pesos(l.tarifa_aplicada)}</td>
                <td><span className={`etiqueta ${CLASE_PIEZA[l.estado_devolucion]}`}>{t('rentaDetalle.estadoDevolucion.' + l.estado_devolucion, { defaultValue: l.estado_devolucion })}</span></td>
                <td className="num">{l.periodos_cobrados === null ? '—' : num(l.periodos_cobrados)}</td>
                <td className="num">{l.estado_devolucion === 'pendiente' ? '—' : pesos(l.total)}</td>
                {abierta && (
                  <td>
                    {l.estado_devolucion === 'pendiente' && (
                      <span className="fila-acciones">
                        <select value={estadoPieza[l.id] ?? 'devuelta'}
                                onChange={(e) => setEstadoPieza({ ...estadoPieza, [l.id]: e.target.value })}>
                          <option value="devuelta">{t('rentaDetalle.opDevuelta')}</option>
                          <option value="danada">{t('rentaDetalle.opDanada')}</option>
                          <option value="perdida">{t('rentaDetalle.opPerdida')}</option>
                        </select>
                        <button className="secundario" onClick={() => devolver(l)}>{t('rentaDetalle.registrar')}</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t('rentaDetalle.cargosExtra')}</h3>
      <p className="suave">{t('rentaDetalle.notaCargos')}</p>
      {r.cargos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('rentaDetalle.thMotivo')}</th><th>{t('rentaDetalle.thPieza')}</th><th>{t('rentaDetalle.thDetalle')}</th><th className="num">{t('rentaDetalle.thMonto')}</th></tr></thead>
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
          <Campo etiqueta={t('rentaDetalle.thPieza')} ayuda={t('rentaDetalle.ayudaPieza')}>
            <select value={cargo.renta_detalle_id} onChange={(e) => setCargo({ ...cargo, renta_detalle_id: e.target.value })} required>
              <option value="">{t('catalogoRenta.elegir')}</option>
              {r.lineas.map((l) => <option key={l.id} value={l.id}>{l.unidad} · {l.producto}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t('rentaDetalle.campoMotivoCargo')} ayuda={t('rentaDetalle.ayudaMotivoCargo')}>
            <select value={cargo.concepto_cargo_id} onChange={(e) => setCargo({ ...cargo, concepto_cargo_id: e.target.value })} required>
              <option value="">{t('catalogoRenta.elegir')}</option>
              {conceptos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t('rentaDetalle.thMonto')} ayuda={t('rentaDetalle.ayudaMontoCargo')}>
            <input type="number" min="0" step="0.01" placeholder={t('rentaDetalle.ejMonto')} value={cargo.monto}
                   onChange={(e) => setCargo({ ...cargo, monto: e.target.value })} required />
          </Campo>
          <Campo etiqueta={t('rentaDetalle.campoDetalle')}>
            <input placeholder={t('rentaDetalle.ejDetalle')} value={cargo.descripcion}
                   onChange={(e) => setCargo({ ...cargo, descripcion: e.target.value })} />
          </Campo>
          <button className="secundario">{t('rentaDetalle.agregarCargo')}</button>
        </form>
      )}

      <h3>{t('rentaDetalle.movimientos')}</h3>
      {r.pagos.length > 0 ? (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{t('comun.fecha')}</th><th>{t('rentaDetalle.thQuePaso')}</th><th>{t('rentaDetalle.thCaja')}</th><th>{t('ventaDetalle.thMetodo')}</th><th>{t('ventaDetalle.thReferencia')}</th><th className="num">{t('rentaDetalle.thMonto')}</th></tr></thead>
            <tbody>
              {r.pagos.map((p) => (
                <tr key={p.id}><td>{fechaHora(p.fecha)}</td><td>{t('rentaDetalle.mov.' + p.tipo + '.quien', { defaultValue: p.tipo })}</td>
                    <td><span className="suave">{t('rentaDetalle.mov.' + p.tipo + '.caja', { defaultValue: '' })}</span></td>
                    <td>{p.tipo === 'aplicacion_deposito' ? '—' : t('metodos.' + p.metodo, { defaultValue: p.metodo })}</td>
                    <td>{p.referencia ?? '—'}</td><td className="num">{pesos(p.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="suave">{t('rentaDetalle.sinMovimientos')}</p>}

      {abierta && (
        <>
          <h3>{t('rentaDetalle.registrarMov')}</h3>
          <div className="segmentos">
            {TIPOS.map((k) => (
              <button type="button" key={k} className={`segmento ${pago.tipo === k ? 'activo' : ''}`}
                      onClick={() => setPago({ ...pago, tipo: k })}>{t('rentaDetalle.tipo.' + k + '.titulo')}</button>
            ))}
          </div>
          <p className="suave">{t('rentaDetalle.tipo.' + pago.tipo + '.texto')}</p>
          {sugerencias.length > 0 && (
            <p className="suave">{t('rentaDetalle.sugerido')}: {sugerencias.map((s) => (
              <button key={s.texto} type="button" className="secundario"
                      onClick={() => setPago({ ...pago, tipo: s.tipo, monto: String(s.monto) })}>{s.texto}</button>
            ))}</p>
          )}
          <form className="formulario" onSubmit={registrarPago}>
            {pago.tipo !== 'aplicacion_deposito' && (
              <Campo etiqueta={t('ventaDetalle.thMetodo')} ayuda={t('rentaDetalle.ayudaMetodo')}>
                <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
                  <option value="efectivo">{t('metodos.efectivo')}</option>
                  <option value="transferencia">{t('metodos.transferencia')}</option>
                  <option value="tarjeta">{t('metodos.tarjeta')}</option>
                  <option value="otro">{t('metodos.otro')}</option>
                </select>
              </Campo>
            )}
            <Campo etiqueta={t('rentaDetalle.thMonto')} ayuda={t('rentaDetalle.ayudaMontoMov')}>
              <input type="number" min="0" step="0.01" placeholder={t('rentaDetalle.hasta', { valor: pesos(maximo) })} value={pago.monto}
                     onChange={(e) => setPago({ ...pago, monto: e.target.value })} required />
            </Campo>
            <Campo etiqueta={t('ventaDetalle.referenciaPh')} ayuda={t('rentaDetalle.ayudaReferencia')}>
              <input placeholder={t('rentaDetalle.ejReferencia')} value={pago.referencia}
                     onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
            </Campo>
            <button>{t('rentaDetalle.tipo.' + pago.tipo + '.titulo')}</button>
          </form>

          <h3>{t('rentaDetalle.cerrarRenta')}</h3>
          <ul className="chequeo">
            {requisitos.map(([ok, texto]) => <li key={texto} className={ok ? 'cumple' : 'falta'}>{ok ? '✔' : '✗'} {texto}</li>)}
          </ul>
          <div className="acciones">
            <button onClick={cerrar} disabled={!requisitos.every(([ok]) => ok)}>{t('rentaDetalle.cerrarBtn')}</button>
            <button className="secundario" onClick={cancelar}>{t('rentaDetalle.cancelarBtn')}</button>
            <span className="suave">{t('rentaDetalle.cancelarNota')}</span>
          </div>
        </>
      )}
    </>
  );
}
