const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const sesion = {
  token: () => { try { return sessionStorage.getItem('token'); } catch { return null; } },
  guardar: (t) => { try { sessionStorage.setItem('token', t); } catch { /* sin storage */ } },
  borrar: () => { try { sessionStorage.removeItem('token'); } catch { /* sin storage */ } },
};

// Llama al backend. Si falla lanza Error con el mensaje del servidor y el codigo en .status.
export async function api(metodo, ruta, cuerpo) {
  const token = sesion.token();
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/auth/login') { sesion.borrar(); window.location.assign('/login'); }
    const e = new Error((datos && datos.error) || `Error ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return datos;
}
