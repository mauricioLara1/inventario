import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, pesos, fecha } from '../formato';

const CLASE = { borrador: 'neutra', recibida: 'buena', anulada: 'mala' };
const VACIA = { producto_id: '', cantidad: '', costo_unitario: '', fecha_caducidad: '' };

export default function CompraDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
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
      setProductos(p.filter((x) => x.activo && x.precio_venta !== null));
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
    hacer(async () => { await api('POST', `/compras/${id}/lineas`, cuerpo); setForm(VACIA); });
  };
  const quitar = (l) => hacer(() => api('DELETE', `/compras/${id}/lineas/${l.id}`));
  const recibir = () => {
    if (!window.confirm('¿Recibir la compra? El stock entra al inventario y las líneas ya no se podrán cambiar.')) return;
    hacer(() => api('POST', `/compras/${id}/recibir`), 'Compra recibida: el stock ya está en el inventario');
  };
  const anular = () => {
    if (!motivo.trim()) { setError('Escribe el motivo de la anulación'); return; }
    if (!window.confirm('¿Anular la compra? Se descuenta el stock que entró.')) return;
    hacer(() => api('POST', `/compras/${id}/anular`, { motivo: motivo.trim() }), 'Compra anulada');
  };
  const borrar = async () => {
    if (!window.confirm('¿Borrar este borrador?')) return;
    try { await api('DELETE', `/compras/${id}`); navegar('/compras'); } catch (e) { setError(e.message); }
  };

  if (!c) return <>{error ? <p className="error">{error}</p> : <p className="suave">Cargando…</p>}</>;
  const borrador = c.estado === 'borrador';

  return (
    <>
      <p><Link to="/compras">← Compras</Link></p>
      <h2>Compra {c.numero} <span className={`etiqueta ${CLASE[c.estado]}`}>{c.estado}</span></h2>
      <p className="suave">{c.proveedor} · factura {c.numero_factura_proveedor ?? '—'} · {fecha(c.fecha)}</p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {borrador && (
        <form className="formulario" onSubmit={agregar}>
          <select value={form.producto_id} onChange={campo('producto_id')} required>
            <option value="">Producto…</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </select>
          <input type="number" min="0" step="any" placeholder="Cantidad" value={form.cantidad} onChange={campo('cantidad')} required />
          <input type="number" min="0" step="any" placeholder="Costo unitario" value={form.costo_unitario} onChange={campo('costo_unitario')} required />
          <input type="date" title="Caducidad" value={form.fecha_caducidad} onChange={campo('fecha_caducidad')}
                 required={!!prod?.maneja_caducidad} />
          <button>Agregar línea</button>
          <p className="suave ancho">Solo salen productos con precio en esta sucursal (se lo pones en Catálogo). La caducidad es obligatoria si el producto la maneja.</p>
        </form>
      )}

      <div className="tabla-caja">
        <table>
          <thead>
            <tr><th>Código</th><th>Producto</th><th className="num">Cantidad</th><th className="num">Costo</th>
                <th className="num">IVA</th><th>Caduca</th><th className="num">Total</th>{borrador && <th />}</tr>
          </thead>
          <tbody>
            {c.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.codigo}</td><td>{l.nombre}</td><td className="num">{num(l.cantidad)}</td>
                <td className="num">{pesos(l.costo_unitario)}</td>
                <td className="num">{Number(l.impuesto_porcentaje)}%</td>
                <td>{l.fecha_caducidad ? String(l.fecha_caducidad).slice(0, 10) : '—'}</td>
                <td className="num">{pesos(l.total)}</td>
                {borrador && <td><button className="secundario" onClick={() => quitar(l)}>Quitar</button></td>}
              </tr>
            ))}
            {c.lineas.length === 0 && <tr><td colSpan="8" className="vacio">Sin líneas todavía</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan="6" className="num">Subtotal</td><td className="num">{pesos(c.subtotal)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num">IVA</td><td className="num">{pesos(c.impuesto)}</td>{borrador && <td />}</tr>
            <tr><td colSpan="6" className="num"><strong>Total</strong></td><td className="num"><strong>{pesos(c.total)}</strong></td>{borrador && <td />}</tr>
          </tfoot>
        </table>
      </div>

      <div className="acciones">
        {borrador && <button onClick={recibir} disabled={c.lineas.length === 0}>Recibir compra</button>}
        {borrador && <button className="secundario" onClick={borrar}>Borrar borrador</button>}
        {c.estado === 'recibida' && (
          <>
            <input placeholder="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className="peligro" onClick={anular}>Anular compra</button>
          </>
        )}
      </div>
    </>
  );
}
