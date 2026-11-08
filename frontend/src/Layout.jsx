import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, sesion } from './api';

// Cada enlace se muestra si el rol tiene AL MENOS UNO de estos permisos.
const MENU = [
  { to: '/inventario', texto: 'Inventario', permisos: ['inventario.ver'] },
  { to: '/catalogo', texto: 'Catálogo', permisos: ['catalogo.ver', 'catalogo.editar'] },
  { to: '/compras', texto: 'Compras', permisos: ['compras.ver', 'compras.gestionar'] },
  { to: '/ventas', texto: 'Ventas', permisos: ['ventas.gestionar'] },
  { to: '/notas-credito', texto: 'Notas crédito', permisos: ['notas_credito.gestionar'] },
  { to: '/rentas', texto: 'Rentas', permisos: ['rentas.consultar', 'rentas.operar'] },
  { to: '/catalogo-renta', texto: 'Catálogo renta', permisos: ['rentas.catalogo', 'rentas.estado_piezas'] },
  { to: '/informes', texto: 'Informes', permisos: ['informes.ver'] },
  { to: '/usuarios', texto: 'Usuarios', permisos: ['usuarios.gestionar'] },
  { to: '/sucursales', texto: 'Sucursales', permisos: ['sucursales.gestionar'] },
  { to: '/clientes', texto: 'Clientes', permisos: ['clientes.crear', 'clientes.editar'] },
  { to: '/proveedores', texto: 'Proveedores', permisos: ['proveedores.gestionar', 'compras.ver', 'compras.gestionar'] },
];

export default function Layout() {
  const [yo, setYo] = useState(null);
  const navegar = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    api('GET', '/auth/yo').then(setYo).catch(() => {});
  }, []);

  const visibles = yo ? MENU.filter((i) => i.permisos.some((p) => yo.permisos?.includes(p))) : [];

  // Si la dirección actual no está permitida (o es "/"), va a la primera pantalla permitida.
  useEffect(() => {
    if (!yo || visibles.length === 0) return;
    const permitida = visibles.some((i) => pathname === i.to || pathname.startsWith(i.to + '/'));
    if (!permitida) navegar(visibles[0].to, { replace: true });
  }, [yo, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function salir() {
    sesion.borrar();
    navegar('/login', { replace: true });
  }

  return (
    <>
      <header className="barra">
        <strong>Inventario</strong>
        <nav>
          {visibles.map((i) => <NavLink key={i.to} to={i.to}>{i.texto}</NavLink>)}
        </nav>
        <span className="quien">{yo ? `${yo.nombre ?? yo.usuario} · ${yo.rol}` : ''}</span>
        <button className="secundario" onClick={salir}>Salir</button>
      </header>
      <main className="contenido">
        {yo && visibles.length === 0
          ? <p className="error">Tu rol no tiene pantallas disponibles. Pide a un administrador que revise tus permisos.</p>
          : <Outlet />}
      </main>
    </>
  );
}
