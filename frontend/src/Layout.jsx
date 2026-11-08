import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, sesion } from './api';

export default function Layout() {
  const [yo, setYo] = useState(null);
  const navegar = useNavigate();

  useEffect(() => {
    api('GET', '/auth/yo').then(setYo).catch(() => {});
  }, []);

  function salir() {
    sesion.borrar();
    navegar('/login', { replace: true });
  }

  return (
    <>
      <header className="barra">
        <strong>Inventario</strong>
        <nav>
          <NavLink to="/inventario">Inventario</NavLink>
          <NavLink to="/catalogo">Catálogo</NavLink>
          <NavLink to="/compras">Compras</NavLink>
          <NavLink to="/ventas">Ventas</NavLink>
          <NavLink to="/notas-credito">Notas crédito</NavLink>
          <NavLink to="/rentas">Rentas</NavLink>
          <NavLink to="/catalogo-renta">Catálogo renta</NavLink>
          <NavLink to="/informes">Informes</NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
          <NavLink to="/proveedores">Proveedores</NavLink>
        </nav>
        <span className="quien">{yo ? `${yo.nombre ?? yo.usuario} · ${yo.rol}` : ''}</span>
        <button className="secundario" onClick={salir}>Salir</button>
      </header>
      <main className="contenido"><Outlet /></main>
    </>
  );
}
