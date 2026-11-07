import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const VACIO = { nombre: '', nit: '', telefono: '', correo: '', direccion: '' };

export default function Proveedores() {
  const [lista, setLista] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(() => {
    api('GET', `/proveedores?q=${encodeURIComponent(q)}`)
      .then((p) => { setLista(p); setError(''); })
      .catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => { cargar(); }, [cargar]);

  const campo = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function crear(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = {};
    for (const [k, v] of Object.entries(form)) if (v.trim()) cuerpo[k] = v.trim();
    try {
      const p = await api('POST', '/proveedores', cuerpo);
      setForm(VACIO); setAviso(`Proveedor ${p.nombre} creado`);
      cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Proveedores</h2>
      <form className="formulario" onSubmit={crear}>
        <input placeholder="Nombre *" value={form.nombre} onChange={campo('nombre')} required />
        <input placeholder="NIT" value={form.nit} onChange={campo('nit')} />
        <input placeholder="Teléfono" value={form.telefono} onChange={campo('telefono')} />
        <input type="email" placeholder="Correo" value={form.correo} onChange={campo('correo')} />
        <input placeholder="Dirección" value={form.direccion} onChange={campo('direccion')} />
        <button>Crear proveedor</button>
      </form>
      <div className="filtros">
        <input placeholder="Buscar por nombre o NIT" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Nombre</th><th>NIT</th><th>Teléfono</th><th>Correo</th><th>Dirección</th><th>Estado</th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td>{p.nombre}</td><td>{p.nit ?? '—'}</td><td>{p.telefono ?? '—'}</td>
                <td>{p.correo ?? '—'}</td><td>{p.direccion ?? '—'}</td>
                <td><span className={`etiqueta ${p.activo ? 'buena' : 'neutra'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan="6" className="vacio">Sin proveedores</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
