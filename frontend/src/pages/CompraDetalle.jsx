import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { borrador: 'neutra', recibida: 'buena', anulada: 'mala' };
const VACIA = { producto_id: '', cantidad: '', costo_unitario: '', fecha_caducidad: '', precio_venta: '' };

export default function CompraDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { t } = useTranslation();
  const [c, setC] = useState(null);
  const [productos, setProductos] = useState([]);
  const [form, setForm] = useState(VACIA);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const compra = await api('GET', `/compras/${id}`);
      setC(compra);
      const p = await api('GET', `/catalogo/productos?sucursal_id=${compra.sucursal_id}`);
      setProductos(p.filter((x) => x.activo));
      setError('');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const campo = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const prod = productos.find((p) => String(p.id) === form.producto_id);

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); if (mensaje) setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }

  const agregar = (e) => {
    e.preventDefault();
    const cuerpo = { producto_id: Number(form.producto_id), cantidad: Number(form.cantidad),
                     costo_unitario: Number(form.costo_unitario) };
    if (form.fecha_caducidad) cuerpo.fecha_caducidad = form.fecha_caducidad;
    hacer(async () => {
      if (prod && prod.precio_venta === null) {
        await api('PUT', `/catalogo/productos/${prod.id}/sucursales/${c.sucursal_id}`,
          { precio_venta: Number(form.precio_venta) });
      }
      await api('POST', `/compras/${id}/lineas`, cuerpo);
      setForm(VACIA);
    });
  };
  const quitar = (l) => hacer(() => api('DELETE', `/compras/${id}/lineas/${l.id}`));
  const recibir = () => {
    if (!window.confirm(t('compraDetalle.confirmRecibir'))) return;
    hacer(() => api('POST', `/compras/${id}/recibir`), t('compraDetalle.recibida'));
  };
  const anular = () => {
    if (!motivo.trim()) { setError(t('compraDetalle.errorMotivo')); return; }
    if (!window.confirm(t('compraDetalle.confirmAnular'))) return;
    hacer(() => api('POST', `/compras/${id}/anular`, { motivo: motivo.trim() }), t('compraDetalle.anulada'));
  };
  const borrar = async () => {
    if (!window.confirm(t('compraDetalle.confirmBorrar'))) return;
    try { await api('DELETE', `/compras/${id}`); navegar('/compras'); } catch (e) { setError(e.message); }
  };

  if (!c) return <>{error ? <p className="error">{error}</p> : <p className="suave">{t('comun.cargando')}</p>}</>;
  const borrador = c.estado === 'borrador';

  return (
    <>
      <p><Link to="/compras">← {t('menu.compras')}</Link></p>
      <h2>{t('compraDetalle.compra')} {c.numero} <span className={`etiqueta ${CLASE[c.estado]}`}>{t('estados.' + c.estado, { defaultValue: c.estado })}</span></h2>
      <p className="suave">{c.proveedor} · {t('compraDetalle.facturaMin')} {c.numero_factura_proveedor ?? '—'} · {fecha(c.fecha)}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={form.producto_id} onChange={campo('producto_id')} required>
            <option value="">{t('compraDetalle.productoOpcion')}</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}{p.precio_venta === null ? ' · ' + t('compraDetalle.sinPrecio') : ''}</option>)}
          </select>
          <input type="number" min="0" step="any" placeholder={t('compraDetalle.cantidad')} value={form.cantidad} onChange={campo('cantidad')} required />
          <input type="number" min="0" step="any" placeholder={t('compraDetalle.costoUnitario')} value={form.costo_unitario} onChange={campo('costo_unitario')} required />
          <input type="date" title={t('compraDetalle.caducidad')} value={form.fecha_caducidad} onChange={campo('fecha_caducidad')}
                 required={!!prod?.maneja_caducidad} />
          {prod && prod.precio_venta === null && (
            <input type="number" min="0" step="any" placeholder={t('compraDetalle.precioVenta')}
                   value={form.precio_venta} onChange={campo('precio_venta')} required />
          )}
          <button>{t('compraDetalle.agregar')}</button>
          <p className="suave ancho">{t('compraDetalle.nota')}</p>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>{t('compraDetalle.thCodigo')}</th><th>{t('compraDetalle.thProducto')}</th><th className="num">{t('compraDetalle.cantidad')}</th><th className="num">{t('compraDetalle.thCosto')}</th>
                <th className="num">{t('compraDetalle.iva')}</th><th>{t('compraDetalle.thCaduca')}</th><th className="num">{t('comun.total')}</th>{borrador && <th />}</tr>
          </thead>
          <tbody>
            {c.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.codigo}</td><td>{l.nombre}</td><td className="num">{num(l.cantidad)}</td>
                <td className="num">{pesos(l.costo_unitario)}</td>
                <td className="num">{Number(l.impuesto_porcentaje)}%</td>
                <td>{l.fecha_caducidad ? String(l.fecha_caducidad).slice(0, 10) : '—'}</td>
                <td className="num">{pesos(l.total)}</td>
                {borrador && <td><button className="secundario" onClick={() => quitar(l)}>{t('compraDetalle.quitar')}</button></td>}
              </tr>
            ))}
            {c.lineas.length === 0 && <tr><td colSpan="8" className="vacio">{t('compraDetalle.sinLineas')}</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan="6" className="num">{t('compraDetalle.subtotal')}</td><td className="num">{pesos(c.subtotal)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num">{t('compraDetalle.iva')}</td><td className="num">{pesos(c.impuesto)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num"><strong>{t('comun.total')}</strong></td><td className="num"><strong>{pesos(c.total)}</strong></td>{borrador && <td />}</tr>
          </tfoot>
        </table>
      </div>

      <div className="acciones">
        {borrador && <button onClick={recibir} disabled={c.lineas.length === 0}>{t('compraDetalle.recibirBtn')}</button>}
        {borrador && <button className="secundario" onClick={borrar}>{t('compraDetalle.borrarBtn')}</button>}
        {c.estado === 'recibida' && (
          <>
            <input placeholder={t('compraDetalle.motivoPh')} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className="peligro" onClick={anular}>{t('compraDetalle.anularBtn')}</button>
          </>
        )}
      </div>
    </>
  );
}
