import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, sesion } from '../api';

export default function Login() {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navegar = useNavigate();

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
        <h1>Inventario</h1>
        <label>Usuario
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus required />
        </label>
        <label>Contraseña
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}
