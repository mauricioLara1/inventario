import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { sesion } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import Inventario from './pages/Inventario';
import Catalogo from './pages/Catalogo';
import Compras from './pages/Compras';
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
          <Route path="proveedores" element={<Proveedores />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
