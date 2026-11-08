import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Campo from '../Campo';

const NUEVO = { nombre: '', usuario: '', clave: '', categoria_empleado_id: '', sucursales: [] };
const MI_CLAVE = { clave_actual: '', clave_nueva: '' };
const alternar = (lista, id) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

function SelectorSucursales({ activas, valor, onCambiar }) {
  const elegidas = activas.filter((s) => valor.includes(s.id));
  const texto = elegidas.length === 0 ? 'Elegir sucursales…'
    : elegidas.length <= 2 ? elegidas.map((s) => s.nombre).join(', ') : `${elegidas.length} seleccionadas`;
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
    if (form.clave.length < 10) { setError('La contraseña debe tener mínimo 10 caracteres'); return; }
    if (form.sucursales.length === 0) { setError('Elige al menos una sucursal'); return; }
    hacer(async () => {
      await api('POST', '/usuarios', {
        nombre: form.nombre.trim(), usuario: form.usuario.trim(), clave: form.clave,
        categoria_empleado_id: Number(form.categoria_empleado_id), sucursales: form.sucursales });
      setForm(NUEVO);
    }, 'Usuario creado');
  }

  function empezarEdicion(u) {
    setClaveId(null); setEditId(u.id);
    setEdit({ nombre: u.nombre, rol_id: String(roles.find((r) => r.nombre === u.rol)?.id ?? ''), sucursales: u.sucursales });
  }
  const guardarEdicion = () => hacer(async () => {
    await api('PUT', `/usuarios/${editId}`, {
      nombre: edit.nombre.trim(), categoria_empleado_id: Number(edit.rol_id), sucursales: edit.sucursales });
    setEditId(null);
  }, 'Usuario actualizado');

  const cambiarActivo = (u) => {
    if (!window.confirm(u.activo
      ? `¿Desactivar a ${u.nombre}? Se le cierra la sesión de inmediato y no podrá entrar.`
      : `¿Activar a ${u.nombre}?`)) return;
    hacer(() => api('PUT', `/usuarios/${u.id}/activo`, { activo: !u.activo }), u.activo ? 'Usuario desactivado' : 'Usuario activado');
  };

  function cambiarClave() {
    if (claveNueva.length < 10) { setError('La contraseña debe tener mínimo 10 caracteres'); return; }
    hacer(async () => { await api('PUT', `/usuarios/${claveId}/clave`, { clave: claveNueva }); setClaveId(null); setClaveNueva(''); },
      'Contraseña cambiada');
  }

  function cambiarMiClave(e) {
    e.preventDefault();
    if (miClave.clave_nueva.length < 10) { setError('La contraseña nueva debe tener mínimo 10 caracteres'); return; }
    hacer(async () => { await api('POST', '/auth/cambiar-clave', miClave); setMiClave(MI_CLAVE); }, 'Tu contraseña fue cambiada');
  }

  return (
    <>
      <h2>Usuarios</h2>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <form className="formulario" onSubmit={crear}>
        <Campo etiqueta="Nombre"><input placeholder="Ej. María Pérez" value={form.nombre}
               onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Campo>
        <Campo etiqueta="Usuario" ayuda="Nombre con el que inicia sesión. No se puede repetir (no distingue mayúsculas).">
          <input placeholder="Ej. mperez" value={form.usuario} autoComplete="off"
                 onChange={(e) => setForm({ ...form, usuario: e.target.value })} required /></Campo>
        <Campo etiqueta="Contraseña" ayuda="Mínimo 10 caracteres. Entrégasela por un canal seguro y pídele que la cambie en su primer ingreso.">
          <input type="password" placeholder="Mínimo 10 caracteres" value={form.clave} autoComplete="new-password"
                 onChange={(e) => setForm({ ...form, clave: e.target.value })} required /></Campo>
        <Campo etiqueta="Rol" ayuda="Define qué puede hacer el usuario. Solo puedes asignar roles de tu mismo nivel o menor.">
          <select value={form.categoria_empleado_id} onChange={(e) => setForm({ ...form, categoria_empleado_id: e.target.value })} required>
            <option value="">Elegir…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select></Campo>
        <div className="ancho">
          <span className="suave">Sucursales donde puede trabajar</span>
          <SelectorSucursales activas={activas} valor={form.sucursales} onCambiar={(v) => setForm({ ...form, sucursales: v })} />
        </div>
        <button>Crear usuario</button>
      </form>

      <div className="tabla-caja">
        <table>
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Sucursales</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <Fragment key={u.id}>
                <tr className={u.activo ? '' : 'inactivo'}>
                  <td>{u.nombre}</td><td>{u.usuario}</td>
                  <td><span className="etiqueta neutra">{u.rol}</span></td>
                  <td>{u.sucursales.map((id) => nombreSucursal[id] ?? id).join(', ')}</td>
                  <td><span className={`etiqueta ${u.activo ? 'buena' : 'neutra'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="fila-acciones">
                    <button className="secundario" onClick={() => empezarEdicion(u)}>Editar</button>
                    <button className="secundario" onClick={() => { setEditId(null); setClaveId(u.id); setClaveNueva(''); }}>Contraseña</button>
                    <button className="secundario" onClick={() => cambiarActivo(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
                {editId === u.id && (
                  <tr><td colSpan="6">
                    <div className="formulario">
                      <Campo etiqueta="Nombre"><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></Campo>
                      <Campo etiqueta="Rol">
                        <select value={edit.rol_id} onChange={(e) => setEdit({ ...edit, rol_id: e.target.value })}>
                          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                        </select></Campo>
                      <div className="ancho"><span className="suave">Sucursales</span>
                        <SelectorSucursales activas={activas} valor={edit.sucursales} onCambiar={(v) => setEdit({ ...edit, sucursales: v })} /></div>
                      <button onClick={guardarEdicion} disabled={!edit.rol_id || edit.sucursales.length === 0}>Guardar</button>
                      <button className="secundario" onClick={() => setEditId(null)}>Cancelar</button>
                    </div>
                  </td></tr>
                )}
                {claveId === u.id && (
                  <tr><td colSpan="6">
                    <div className="formulario">
                      <Campo etiqueta={`Nueva contraseña para ${u.usuario}`} ayuda="Mínimo 10 caracteres. La sesión actual de esa persona no se cierra; deberá usar la nueva la próxima vez.">
                        <input type="password" autoComplete="new-password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} /></Campo>
                      <button onClick={cambiarClave}>Cambiar contraseña</button>
                      <button className="secundario" onClick={() => setClaveId(null)}>Cancelar</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {usuarios.length === 0 && <tr><td colSpan="6" className="vacio">Sin usuarios</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Mi contraseña</h3>
      <form className="formulario" onSubmit={cambiarMiClave}>
        <Campo etiqueta="Contraseña actual"><input type="password" autoComplete="current-password" value={miClave.clave_actual}
               onChange={(e) => setMiClave({ ...miClave, clave_actual: e.target.value })} required /></Campo>
        <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 10 caracteres y distinta de la actual.">
          <input type="password" autoComplete="new-password" value={miClave.clave_nueva}
                 onChange={(e) => setMiClave({ ...miClave, clave_nueva: e.target.value })} required /></Campo>
        <button>Cambiar mi contraseña</button>
      </form>
    </>
  );
}
