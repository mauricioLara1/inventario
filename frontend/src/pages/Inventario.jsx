import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import { fecha, num, pesos } from '../formato';
import { useTranslation } from 'react-i18next';
import Campo from '../Campo';

// Fecha en que vence el lote mas viejo que aun tiene stock.
function vencimiento(f, t) {
  if (Number(f.cantidad) <= 0) return '—';
  if (!f.proximo_vencimiento) return <span className="suave">{t('inventario.sinCaducidad')}</span>;
  const d = Number(f.dias_para_vencer);
  const texto = d < 0 ? t('inventario.vencidoHace', { d: -d }) : d === 0 ? t('inventario.venceHoy') : t('inventario.en', { d });
  return <>{fecha(f.proximo_vencimiento)} <span className={d <= 7 ? 'etiqueta mala' : 'suave'}>{texto}</span></>;
}

// Alertas de un producto (puede tener varias a la vez).
function alertas(f, t) {
  const lista = [];
  if (Number(f.cantidad_vencida) > 0) lista.push(['mala', t('inventario.vencidoEtiqueta')]);
  else if (f.dias_para_vencer != null && Number(f.dias_para_vencer) <= 7) lista.push(['alerta', t('inventario.porVencerEtiqueta')]);
  if (f.stock_bajo) lista.push(['mala', t('inventario.stockBajo')]);
  return lista;
}

export default function Inventario() {
  const { t } = useTranslation();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [categoria, setCategoria] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [yo, setYo] = useState(null);
  const [recarga, setRecarga] = useState(0);
  const [abierto, setAbierto] = useState(null); // producto con sus lotes desplegados
  const [lotes, setLotes] = useState([]);
  const [baja, setBaja] = useState(null);       // { lote, cantidad, motivo }
  const puedeAjustar = !!yo?.permisos?.includes('inventario.ajustar');

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch((e) => setError(e.message));
    api('GET', '/catalogo/categorias').then((c) => setCategorias(c.filter((x) => x.activo !== false))).catch(() => {});
    api('GET', '/auth/yo').then(setYo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sucursal) return;
    const params = new URLSearchParams({ sucursal_id: sucursal, q });
    if (estado) params.set('estado', estado);
    if (categoria) params.set('categoria_id', categoria);
    api('GET', `/inventario/stock?${params}`)
      .then((f) => { setFilas(f); setError(''); })
      .catch((e) => setError(e.message));
  }, [sucursal, q, estado, categoria, recarga]);

  useEffect(() => {
    if (!abierto || !sucursal) { setLotes([]); return; }
    api('GET', `/inventario/lotes?sucursal_id=${sucursal}&producto_id=${abierto}`)
      .then(setLotes).catch((e) => setError(e.message));
  }, [abierto, sucursal, recarga]);

  const abrir = (id) => { setBaja(null); setAviso(''); setAbierto(abierto === id ? null : id); };

  async function confirmarBaja(e) {
    e.preventDefault();
    setError(''); setAviso('');
    try {
      await api('POST', '/ajustes', { lote_id: Number(baja.lote.lote_id), tipo: 'baja',
        cantidad: Number(baja.cantidad), motivo: baja.motivo.trim() });
      setBaja(null); setAviso(t('inventario.bajaHecha')); setRecarga((n) => n + 1);
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.inventario')}</h2>
      <div className="filtros">
        <select value={sucursal} onChange={(e) => { setSucursal(e.target.value); setAbierto(null); }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder={t('inventario.buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">{t('comun.todosEstados')}</option>
          <option value="vencido">{t('inventario.filtroVencido')}</option>
          <option value="por_vencer">{t('inventario.filtroPorVencer')}</option>
          <option value="bajo">{t('inventario.filtroBajo')}</option>
        </select>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">{t('inventario.todasCategorias')}</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('inventario.codigo')}</th><th>{t('inventario.producto')}</th><th className="num">{t('inventario.disponible')}</th>
                <th className="num">{t('inventario.vencido')}</th><th>{t('inventario.proxVenc')}</th><th className="num">{t('inventario.minimo')}</th>
                <th className="num">{t('inventario.precio')}</th><th>{t('inventario.estado')}</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const al = alertas(f, t);
              return (
                <Fragment key={f.producto_id}>
                  <tr className="fila-click" title={t('inventario.verLotes')} onClick={() => abrir(f.producto_id)}>
                    <td>{f.codigo}</td>
                    <td>{f.nombre}{f.medida ? <span className="suave"> · {f.medida}</span> : null}</td>
                    <td className="num">{num(f.cantidad_vendible)}</td>
                    <td className="num">{Number(f.cantidad_vencida) > 0 ? num(f.cantidad_vencida) : '—'}</td>
                    <td>{vencimiento(f, t)}</td>
                    <td className="num">{num(f.stock_minimo)}</td>
                    <td className="num">{pesos(f.precio_venta)}</td>
                    <td>
                      {al.length === 0
                        ? <span className="etiqueta buena">{t('inventario.ok')}</span>
                        : al.map(([clase, texto]) => <span key={texto} className={'etiqueta ' + clase}>{texto} </span>)}
                    </td>
                  </tr>
                  {abierto === f.producto_id && (
                    <tr>
                      <td colSpan="8">
                        <div className="lotes-panel">
                          <strong>{t('inventario.lotesDe', { nombre: f.nombre })}</strong>
                          <table>
                            <thead>
                              <tr><th>{t('inventario.thLote')}</th><th>{t('inventario.thVence')}</th>
                                  <th className="num">{t('inventario.thSaldo')}</th><th className="num">{t('inventario.thCosto')}</th>
                                  {puedeAjustar && <th></th>}</tr>
                            </thead>
                            <tbody>
                              {lotes.map((l) => (
                                <tr key={l.lote_id}>
                                  <td>#{l.lote_id}</td>
                                  <td>{l.fecha_caducidad
                                    ? <>{fecha(l.fecha_caducidad)} {l.vencido && <span className="etiqueta mala">{t('inventario.vencidoEtiqueta')}</span>}</>
                                    : <span className="suave">{t('inventario.sinCaducidad')}</span>}</td>
                                  <td className="num">{num(l.saldo)}</td>
                                  <td className="num">{pesos(l.costo_unitario)}</td>
                                  {puedeAjustar && (
                                    <td><button type="button" className="secundario"
                                      onClick={() => setBaja({ lote: l, cantidad: String(l.saldo), motivo: l.vencido ? t('inventario.motivoVencido') : '' })}>
                                      {t('inventario.darBaja')}</button></td>
                                  )}
                                </tr>
                              ))}
                              {lotes.length === 0 && <tr><td colSpan="5" className="vacio">{t('inventario.sinLotes')}</td></tr>}
                            </tbody>
                          </table>
                          {baja && (
                            <form className="formulario" onSubmit={confirmarBaja}>
                              <strong>{t('inventario.bajaDelLote', { id: baja.lote.lote_id })}</strong>
                              <Campo etiqueta={t('inventario.cantidadBaja')} ayuda={t('inventario.ayudaCantidadBaja', { max: num(baja.lote.saldo) })}>
                                <input type="number" min="0.001" max={baja.lote.saldo} step="any" value={baja.cantidad}
                                       onChange={(e) => setBaja({ ...baja, cantidad: e.target.value })} required />
                              </Campo>
                              <Campo etiqueta={t('inventario.motivoBaja')} ayuda={t('inventario.ayudaMotivoBaja')}>
                                <input value={baja.motivo} onChange={(e) => setBaja({ ...baja, motivo: e.target.value })} required />
                              </Campo>
                              <button>{t('inventario.confirmarBaja')}</button>
                              <button type="button" className="secundario" onClick={() => setBaja(null)}>{t('inventario.cancelarBaja')}</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filas.length === 0 && <tr><td colSpan="8" className="vacio">{t('inventario.sinProductos')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
