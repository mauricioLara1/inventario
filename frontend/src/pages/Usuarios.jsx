import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Campo from '../Campo';
import { useTranslation } from 'react-i18next';

const NUEVO = { nombre: '', usuario: '', clave: '', categoria_empleado_id: '', sucursales: [] };
const MI_CLAVE = { clave_actual: '', clave_nueva: '' };
const alternar = (lista, id) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

function SelectorSucursales({ activas, valor, onCambiar }) {
  const { t } = useTranslation();
  const elegidas = activas.filter((s) => valor.includes(s.id));
  const texto = elegidas.length === 0 ? t('usuarios.elegirSucursales')
    : elegidas.length <= 2 ? elegidas.map((s) => s.nombre).join(', ') : t('usuarios.nSeleccionadas', { n: elegidas.length });
  return (
    <details className="selector">
      <summary>{texto}</summary>
      <div className="lista">
        {activas.map((s) => (
          <label key={s.id}>
            <input type="checkbox" checked={valor.includes(s.id)} onChange={() => onCambiar(alternar(valor, s.id))} />
            {s.nombre}
          </label>
        ))}
      </div>
    </details>
  );
}

export default function Usuarios() {
  const { t } = useTranslation();
  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [form, setForm] = useState(NUEVO);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ nombre: '', rol_id: '', sucursales: [] });
  const [claveId, setClaveId] = useState(null);
  const [claveNueva, setClaveNueva] = useState('');
  const [miClave, setMiClave] = useState(MI_CLAVE);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [u, r, s] = await Promise.all([api('GET', '/usuarios'), api('GET', '/usuarios/roles'), api('GET', '/sucursales')]);
      setUsuarios(u); setRoles(r); setSucursales(s); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const activas = sucursales.filter((s) => s.activo);
  const nombreSucursal = Object.fromEntries(sucursales.map((s) => [s.id, s.nombre]));

  async function hacer(fn, mensaje) {
    setError(''); setAviso('');
    try { await fn(); if (mensaje) setAviso(mensaje); await cargar(); } catch (e) { setError(e.message); }
  }


  function crear(e) {
    e.preventDefault();
    if (form.clave.length < 10) { setError(t('usuarios.claveCorta')); return; }
    if (form.sucursales.length === 0) { setError(t('usuarios.eligeSucursal')); return; }
    hacer(async () => {
      await api('POST', '/usuarios', {
        nombre: form.nombre.trim(), usuario: form.usuario.trim(), clave: form.clave,
        categoria_empleado_id: Number(form.categoria_empleado_id), sucursales: form.sucursales });
      setForm(NUEVO);
    }, t('usuarios.creado'));
  }

  function empezarEdicion(u) {
    setClaveId(null); setEditId(u.id);
    setEdit({ nombre: u.nombre, rol_id: String(roles.find((r) => r.nombre === u.rol)?.id ?? ''), sucursales: u.sucursales });
  }
  const guardarEdicion = () => hacer(async () => {
    await api('PUT', `/usuarios/${editId}`, {
      nombre: edit.nombre.trim(), categoria_empleado_id: Number(edit.rol_id), sucursales: edit.sucursales });
    setEditId(null);
  }, t('usuarios.actualizado'));

  const cambiarActivo = (u) => {
    if (!window.confirm(u.activo
      ? t('usuarios.confirmDesactivar', { nombre: u.nombre })
      : t('usuarios.confirmActivar', { nombre: u.nombre }))) return;
    hacer(() => api('PUT', `/usuarios/${u.id}/activo`, { activo: !u.activo }), u.activo ? t('usuarios.desactivado') : t('usuarios.activado'));
  };

  function cambiarClave() {
    if (claveNueva.length < 10) { setError(t('usuarios.claveCorta')); return; }
    hacer(async () => { await api('PUT', `/usuarios/${claveId}/clave`, { clave: claveNueva }); setClaveId(null); setClaveNueva(''); },
      t('usuarios.claveCambiada'));
  }

  function cambiarMiClave(e) {
    e.preventDefault();
    if (miClave.clave_nueva.length < 10) { setError(t('usuarios.claveNuevaCorta')); return; }
    hacer(async () => { await api('POST', '/auth/cambiar-clave', miClave); setMiClave(MI_CLAVE); }, t('usuarios.miClaveCambiada'));
  }

  return (
    <>
      <h2>{t('menu.usuarios')}</h2>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <form className="formulario" onSubmit={crear}>
        <Campo etiqueta={t('comun.nombre')}><input placeholder={t('usuarios.ejNombre')} value={form.nombre}
               onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Campo>
        <Campo etiqueta={t('usuarios.usuario')} ayuda={t('usuarios.ayudaUsuario')}>
          <input placeholder={t('usuarios.ejUsuario')} value={form.usuario} autoComplete="off"
                 onChange={(e) => setForm({ ...form, usuario: e.target.value })} required /></Campo>
        <Campo etiqueta={t('usuarios.clave')} ayuda={t('usuarios.ayudaClave')}>
          <input type="password" placeholder={t('usuarios.minimo10')} value={form.clave} autoComplete="new-password"
                 onChange={(e) => setForm({ ...form, clave: e.target.value })} required /></Campo>
        <Campo etiqueta={t('usuarios.rol')} ayuda={t('usuarios.ayudaRol')}>
          <select value={form.categoria_empleado_id} onChange={(e) => setForm({ ...form, categoria_empleado_id: e.target.value })} required>
            <option value="">{t('usuarios.elegir')}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select></Campo>
        <div className="ancho">
          <span className="suave">{t('usuarios.sucursalesDonde')}</span>
          <SelectorSucursales activas={activas} valor={form.sucursales} onCambiar={(v) => setForm({ ...form, sucursales: v })} />
        </div>
        <button>{t('usuarios.crear')}</button>
      </form>

      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('comun.nombre')}</th><th>{t('usuarios.usuario')}</th><th>{t('usuarios.rol')}</th><th>{t('menu.sucursales')}</th><th>{t('comun.estado')}</th><th /></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <Fragment key={u.id}>
                <tr className={u.activo ? '' : 'inactivo'}>
                  <td>{u.nombre}</td><td>{u.usuario}</td>
                  <td><span className="etiqueta neutra">{u.rol}</span></td>
                  <td>{u.sucursales.map((id) => nombreSucursal[id] ?? id).join(', ')}</td>
                  <td><span className={`etiqueta ${u.activo ? 'buena' : 'neutra'}`}>{u.activo ? t('comun.activo') : t('comun.inactivo')}</span></td>
                  <td className="fila-acciones">
                    <button className="secundario" onClick={() => empezarEdicion(u)}>{t('comun.editar')}</button>
                    <button className="secundario" onClick={() => { setEditId(null); setClaveId(u.id); setClaveNueva(''); }}>{t('usuarios.clave')}</button>
                    <button className="secundario" onClick={() => cambiarActivo(u)}>{u.activo ? t('comun.desactivar') : t('comun.activar')}</button>
                  </td>
                </tr>
                {editId === u.id && (
                  <tr><td colSpan="6">
                    <div className="formulario">
                      <Campo etiqueta={t('comun.nombre')}><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></Campo>
                      <Campo etiqueta={t('usuarios.rol')}>
                        <select value={edit.rol_id} onChange={(e) => setEdit({ ...edit, rol_id: e.target.value })}>
                          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                        </select></Campo>
                      <div className="ancho"><span className="suave">{t('menu.sucursales')}</span>
                        <SelectorSucursales activas={activas} valor={edit.sucursales} onCambiar={(v) => setEdit({ ...edit, sucursales: v })} /></div>
                      <button onClick={guardarEdicion} disabled={!edit.rol_id || edit.sucursales.length === 0}>{t('comun.guardar')}</button>
                      <button className="secundario" onClick={() => setEditId(null)}>{t('comun.cancelar')}</button>
                    </div>
                  </td></tr>
                )}
                {claveId === u.id && (
                  <tr><td colSpan="6">
                    <div className="formulario">
                      <Campo etiqueta={t('usuarios.nuevaClavePara', { usuario: u.usuario })} ayuda={t('usuarios.ayudaClaveNueva')}>
                        <input type="password" autoComplete="new-password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} /></Campo>
                      <button onClick={cambiarClave}>{t('usuarios.cambiarClave')}</button>
                      <button className="secundario" onClick={() => setClaveId(null)}>{t('comun.cancelar')}</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {usuarios.length === 0 && <tr><td colSpan="6" className="vacio">{t('usuarios.sinUsuarios')}</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>{t('usuarios.miClave')}</h3>
      <form className="formulario" onSubmit={cambiarMiClave}>
        <Campo etiqueta={t('usuarios.claveActual')}><input type="password" autoComplete="current-password" value={miClave.clave_actual}
               onChange={(e) => setMiClave({ ...miClave, clave_actual: e.target.value })} required /></Campo>
        <Campo etiqueta={t('usuarios.claveNueva')} ayuda={t('usuarios.ayudaClaveNuevaMia')}>
          <input type="password" autoComplete="new-password" value={miClave.clave_nueva}
                 onChange={(e) => setMiClave({ ...miClave, clave_nueva: e.target.value })} required /></Campo>
        <button>{t('usuarios.cambiarMiClave')}</button>
      </form>
    </>
  );
}
