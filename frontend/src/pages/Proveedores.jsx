import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useTranslation } from 'react-i18next';

const VACIO = { nombre: '', nit: '', telefono: '', correo: '', direccion: '' };

export default function Proveedores() {
  const { t } = useTranslation();
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
      setForm(VACIO); setAviso(t('proveedores.creado', { nombre: p.nombre }));
      cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>{t('menu.proveedores')}</h2>
      <form className="formulario" onSubmit={crear}>
        <input placeholder={t('proveedores.nombrePh')} value={form.nombre} onChange={campo('nombre')} required />
        <input placeholder="NIT" value={form.nit} onChange={campo('nit')} />
        <input placeholder={t('comun.telefono')} value={form.telefono} onChange={campo('telefono')} />
        <input type="email" placeholder={t('comun.correo')} value={form.correo} onChange={campo('correo')} />
        <input placeholder={t('comun.direccion')} value={form.direccion} onChange={campo('direccion')} />
        <button>{t('proveedores.crear')}</button>
      </form>
      <div className="filtros">
        <input placeholder={t('proveedores.buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('comun.nombre')}</th><th>NIT</th><th>{t('comun.telefono')}</th><th>{t('comun.correo')}</th><th>{t('comun.direccion')}</th><th>{t('comun.estado')}</th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td>{p.nombre}</td><td>{p.nit ?? '—'}</td><td>{p.telefono ?? '—'}</td>
                <td>{p.correo ?? '—'}</td><td>{p.direccion ?? '—'}</td>
                <td><span className={`etiqueta ${p.activo ? 'buena' : 'neutra'}`}>{p.activo ? t('comun.activo') : t('comun.inactivo')}</span></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan="6" className="vacio">{t('proveedores.sinProveedores')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
