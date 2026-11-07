import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { sesion } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import Inventario from './pages/Inventario';
import Catalogo from './pages/Catalogo';
import Compras from './pages/Compras';
import Ventas from './pages/Ventas';
import VentaDetalle from './pages/VentaDetalle';
import CompraDetalle from './pages/CompraDetalle';
import Proveedores from './pages/Proveedores';

function Protegida({ children }) {
  return sesion.token() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protegida><Layout /></Protegida>}>
          <Route index element={<Navigate to="/inventario" replace />} />
          <Route path="inventario" element={<Inventario />} />
          <Route path="catalogo" element={<Catalogo />} />
          <Route path="compras" element={<Compras />} />
          <Route path="compras/:id" element={<CompraDetalle />} />
          <Route path="ventas" element={<Ventas />} />
          <Route path="ventas/:id" element={<VentaDetalle />} />
          <Route path="proveedores" element={<Proveedores />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
