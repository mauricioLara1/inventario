import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, sesion } from '../api';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navegar = useNavigate();
  const { t } = useTranslation();

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await api('POST', '/auth/login', { usuario, clave });
      sesion.guardar(r.token);
      navegar('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <main className="centro">
      <form className="tarjeta" onSubmit={enviar}>
        <h1>{t('menu.inventario')}</h1>
        <label>{t('login.usuario')}
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus required />
        </label>
        <label>{t('login.clave')}
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={enviando}>{enviando ? t('login.entrando') : t('login.entrar')}</button>
      </form>
    </main>
  );
}
