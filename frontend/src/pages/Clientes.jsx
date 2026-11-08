import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useTranslation } from 'react-i18next';

const VACIO = { nombre: '', tipo_documento: '', numero_documento: '', telefono: '', correo: '' };
const limpio = (x) => (x && x.trim() ? x.trim() : null);

export default function Clientes() {
  const { t } = useTranslation();
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
      setForm(VACIO); setAviso(t('clientes.creado', { nombre: c.nombre })); cargar();
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
      setEditId(null); setAviso(t('clientes.actualizado')); cargar();
    } catch (err) { setError(err.message); }
  }

  async function desactivar(c) {
    if (!window.confirm(t('clientes.confirmDesactivar', { nombre: c.nombre }))) return;
    setError(''); setAviso('');
    try { await api('PUT', `/clientes/${c.id}/activo`, { activo: false }); setAviso(t('clientes.desactivado')); cargar(); }
    catch (err) { setError(err.message); }
  }

  async function bloquear(c) {
    const cuerpo = { bloqueado: !c.bloqueado };
    if (!c.bloqueado) {
      const m = window.prompt(t('clientes.motivo', { nombre: c.nombre }));
      if (!m || !m.trim()) return;
      cuerpo.motivo = m.trim();
    }
    setError(''); setAviso('');
    try {
      await api('PUT', `/clientes/${c.id}/bloqueo`, cuerpo);
      setAviso(c.bloqueado ? t('clientes.desbloqueado') : t('clientes.bloqueadoOk')); cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.clientes')}</h2>
      <form className="formulario" onSubmit={crear}>
        <input placeholder={t('clientes.nombrePh')} value={form.nombre} onChange={campo('nombre')} required />
        <input placeholder={t('clientes.tipoDoc')} list="tipos" value={form.tipo_documento} onChange={campo('tipo_documento')} />
        <input placeholder={t('clientes.numDoc')} value={form.numero_documento} onChange={campo('numero_documento')} />
        <input placeholder={t('clientes.telefono')} value={form.telefono} onChange={campo('telefono')} />
        <input type="email" placeholder={t('clientes.correo')} value={form.correo} onChange={campo('correo')} />
        <button>{t('clientes.crear')}</button>
        <p className="suave ancho">{t('clientes.nota')}</p>
      </form>
      <datalist id="tipos"><option value="CC" /><option value="NIT" /><option value="CE" /><option value="PASAPORTE" /></datalist>
      <div className="filtros">
        <input placeholder={t('clientes.buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('comun.nombre')}</th><th>{t('clientes.documento')}</th><th>{t('clientes.telefono')}</th><th>{t('clientes.correo')}</th><th>{t('comun.estado')}</th><th /></tr></thead>
          <tbody>
            {lista.map((c) => (editId === c.id ? (
              <tr key={c.id}>
                <td><input value={edit.nombre} onChange={campoEdit('nombre')} /></td>
                <td className="doble">
                  <input placeholder={t('clientes.tipo')} value={edit.tipo_documento} onChange={campoEdit('tipo_documento')} />
                  <input placeholder={t('clientes.numero')} value={edit.numero_documento} onChange={campoEdit('numero_documento')} />
                </td>
                <td><input value={edit.telefono} onChange={campoEdit('telefono')} /></td>
                <td><input value={edit.correo} onChange={campoEdit('correo')} /></td>
                <td />
                <td className="fila-acciones">
                  <button onClick={guardar}>{t('comun.guardar')}</button>
                  <button className="secundario" onClick={() => setEditId(null)}>{t('comun.cancelar')}</button>
                </td>
              </tr>
            ) : (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.tipo_documento ? `${c.tipo_documento} ${c.numero_documento}` : '—'}</td>
                <td>{c.telefono ?? <span className="suave">{t('clientes.sinTelefono')}</span>}</td>
                <td>{c.correo ?? '—'}</td>
                <td>{c.bloqueado ? <span className="etiqueta mala">{t('clientes.bloqueado')}</span> : <span className="etiqueta buena">{t('comun.activo')}</span>}</td>
                <td className="fila-acciones">
                  <button className="secundario" onClick={() => empezarEdicion(c)}>{t('comun.editar')}</button>
                  <button className="secundario" onClick={() => bloquear(c)}>{c.bloqueado ? t('clientes.desbloquear') : t('clientes.bloquear')}</button>
                  <button className="secundario" onClick={() => desactivar(c)}>{t('clientes.desactivar')}</button>
                </td>
              </tr>
            )))}
            {lista.length === 0 && <tr><td colSpan="6" className="vacio">{t('clientes.sinClientes')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
