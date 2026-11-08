import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Campo from '../Campo';

const NUEVA = { nombre: '', direccion: '' };

export default function Sucursales() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(NUEVA);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(NUEVA);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try { setLista(await api('GET', '/sucursales')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }

  const crear = (e) => {
    e.preventDefault();
    hacer(async () => {
      await api('POST', '/sucursales', { nombre: form.nombre.trim(), direccion: form.direccion.trim() });
      setForm(NUEVA);
    }, 'Sucursal creada');
  };

  const guardar = () => hacer(async () => {
    await api('PUT', `/sucursales/${editId}`, { nombre: edit.nombre.trim(), direccion: edit.direccion.trim() });
    setEditId(null);
  }, 'Sucursal actualizada');

  const cambiarActivo = (s) => {
    if (!window.confirm(s.activo ? `¿Desactivar ${s.nombre}?` : `¿Activar ${s.nombre}?`)) return;
    hacer(() => api('PUT', `/sucursales/${s.id}/activo`, { activo: !s.activo }),
      s.activo ? 'Sucursal desactivada' : 'Sucursal activada');
  };

  return (
    <>
      <h2>Sucursales</h2>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <form className="formulario" onSubmit={crear}>
        <Campo etiqueta="Nombre"><input placeholder="Ej. Sede Centro" value={form.nombre}
               onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Campo>
        <Campo etiqueta="Dirección"><input placeholder="Ej. Calle 5 # 10-20" value={form.direccion}
               onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></Campo>
        <button>Crear sucursal</button>
      </form>

      <div className="tabla-caja">
        <table>
          <thead><tr><th>Nombre</th><th>Dirección</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id} className={s.activo ? '' : 'inactivo'}>
                {editId === s.id ? (
                  <>
                    <td><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></td>
                    <td><input value={edit.direccion} onChange={(e) => setEdit({ ...edit, direccion: e.target.value })} /></td>
                    <td />
                    <td className="fila-acciones">
                      <button onClick={guardar} disabled={!edit.nombre.trim()}>Guardar</button>
                      <button className="secundario" onClick={() => setEditId(null)}>Cancelar</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{s.nombre}</td><td>{s.direccion || '—'}</td>
                    <td><span className={`etiqueta ${s.activo ? 'buena' : 'neutra'}`}>{s.activo ? 'Activa' : 'Inactiva'}</span></td>
                    <td className="fila-acciones">
                      <button className="secundario" onClick={() => { setEditId(s.id); setEdit({ nombre: s.nombre, direccion: s.direccion || '' }); }}>Editar</button>
                      <button className="secundario" onClick={() => cambiarActivo(s)}>{s.activo ? 'Desactivar' : 'Activar'}</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan="4" className="vacio">Sin sucursales</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
