import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const VACIO = { nombre: '', tipo_documento: '', numero_documento: '', telefono: '', correo: '' };
const limpio = (x) => (x && x.trim() ? x.trim() : null);

export default function Clientes() {
  const [lista, setLista] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(VACIO);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(VACIO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(() => {
    api('GET', `/clientes?q=${encodeURIComponent(q)}`)
      .then((c) => { setLista(c); setError(''); })
      .catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => { cargar(); }, [cargar]);

  const campo = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const campoEdit = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  async function crear(e) {
    e.preventDefault();
    setError(''); setAviso('');
    const cuerpo = {};
    for (const [k, v] of Object.entries(form)) if (v.trim()) cuerpo[k] = v.trim();
    if (cuerpo.tipo_documento) cuerpo.tipo_documento = cuerpo.tipo_documento.toUpperCase();
    try {
      const c = await api('POST', '/clientes', cuerpo);
      setForm(VACIO); setAviso(`Cliente ${c.nombre} creado`); cargar();
    } catch (err) { setError(err.message); }
  }

  function empezarEdicion(c) {
    setEditId(c.id); setError(''); setAviso('');
    setEdit({ nombre: c.nombre ?? '', tipo_documento: c.tipo_documento ?? '',
              numero_documento: c.numero_documento ?? '', telefono: c.telefono ?? '', correo: c.correo ?? '' });
  }

  async function guardar() {
    setError(''); setAviso('');
    const tipo = limpio(edit.tipo_documento);
    try {
      await api('PUT', `/clientes/${editId}`, {
        nombre: edit.nombre.trim(), tipo_documento: tipo ? tipo.toUpperCase() : null,
        numero_documento: limpio(edit.numero_documento), telefono: limpio(edit.telefono),
        correo: limpio(edit.correo) });
      setEditId(null); setAviso('Cliente actualizado'); cargar();
    } catch (err) { setError(err.message); }
  }

  async function desactivar(c) {
    if (!window.confirm(`¿Desactivar a ${c.nombre}? Dejará de aparecer en las listas (su historial se conserva).`)) return;
    setError(''); setAviso('');
    try { await api('PUT', `/clientes/${c.id}/activo`, { activo: false }); setAviso('Cliente desactivado'); cargar(); }
    catch (err) { setError(err.message); }
  }

  async function bloquear(c) {
    const cuerpo = { bloqueado: !c.bloqueado };
    if (!c.bloqueado) {
      const m = window.prompt(`Motivo para bloquear a ${c.nombre}:`);
      if (!m || !m.trim()) return;
      cuerpo.motivo = m.trim();
    }
    setError(''); setAviso('');
    try {
      await api('PUT', `/clientes/${c.id}/bloqueo`, cuerpo);
      setAviso(c.bloqueado ? 'Cliente desbloqueado' : 'Cliente bloqueado'); cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Clientes</h2>
      <form className="formulario" onSubmit={crear}>
        <input placeholder="Nombre *" value={form.nombre} onChange={campo('nombre')} required />
        <input placeholder="Tipo doc. (CC, NIT…)" list="tipos" value={form.tipo_documento} onChange={campo('tipo_documento')} />
        <input placeholder="Número de documento" value={form.numero_documento} onChange={campo('numero_documento')} />
        <input placeholder="Teléfono" value={form.telefono} onChange={campo('telefono')} />
        <input type="email" placeholder="Correo" value={form.correo} onChange={campo('correo')} />
        <button>Crear cliente</button>
        <p className="suave ancho">El tipo y el número de documento van juntos o ambos vacíos. Para abrir una renta el cliente necesita teléfono.</p>
      </form>
      <datalist id="tipos"><option value="CC" /><option value="NIT" /><option value="CE" /><option value="PASAPORTE" /></datalist>
      <div className="filtros">
        <input placeholder="Buscar por nombre, documento o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {lista.map((c) => (editId === c.id ? (
              <tr key={c.id}>
                <td><input value={edit.nombre} onChange={campoEdit('nombre')} /></td>
                <td className="doble">
                  <input placeholder="Tipo" value={edit.tipo_documento} onChange={campoEdit('tipo_documento')} />
                  <input placeholder="Número" value={edit.numero_documento} onChange={campoEdit('numero_documento')} />
                </td>
                <td><input value={edit.telefono} onChange={campoEdit('telefono')} /></td>
                <td><input value={edit.correo} onChange={campoEdit('correo')} /></td>
                <td />
                <td className="fila-acciones">
                  <button onClick={guardar}>Guardar</button>
                  <button className="secundario" onClick={() => setEditId(null)}>Cancelar</button>
                </td>
              </tr>
            ) : (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.tipo_documento ? `${c.tipo_documento} ${c.numero_documento}` : '—'}</td>
                <td>{c.telefono ?? <span className="suave">Sin teléfono</span>}</td>
                <td>{c.correo ?? '—'}</td>
                <td>{c.bloqueado ? <span className="etiqueta mala">Bloqueado</span> : <span className="etiqueta buena">Activo</span>}</td>
                <td className="fila-acciones">
                  <button className="secundario" onClick={() => empezarEdicion(c)}>Editar</button>
                  <button className="secundario" onClick={() => bloquear(c)}>{c.bloqueado ? 'Desbloquear' : 'Bloquear'}</button>
                  <button className="secundario" onClick={() => desactivar(c)}>Desactivar</button>
                </td>
              </tr>
            )))}
            {lista.length === 0 && <tr><td colSpan="6" className="vacio">Sin clientes</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
