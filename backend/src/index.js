require('dotenv').config();
const express = require('express');
const pool = require('./db');

if (!process.env.JWT_SECRET) { console.error('Falta JWT_SECRET en .env'); process.exit(1); }

const app = express();
require('./seguridad')(app);
app.use(express.json());

app.get('/salud', async (req, res) => {
  try {
    const r = await pool.query('SELECT count(*)::int AS categorias FROM categoria_empleado');
    res.json({ ok: true, categorias: r.rows[0].categorias });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/auth', require('./rutas/auth'));

app.use('/sucursales', require('./rutas/sucursales'));
app.use('/usuarios', require('./rutas/usuarios'));
app.use('/usuarios', require('./rutas/usuarios_roles'));
app.use('/catalogo', require('./rutas/catalogo'));
app.use('/proveedores', require('./rutas/proveedores'));
app.use('/compras', require('./rutas/compras'));
app.use('/inventario', require('./rutas/inventario'));
app.use('/ventas', require('./rutas/ventas'));
app.use('/notas-credito', require('./rutas/notas_credito'));
app.use('/renta-catalogo', require('./rutas/renta_catalogo'));
app.use('/rentas', require('./rutas/rentas'));
app.use('/informes', require('./rutas/informes'));
app.use('/ajustes', require('./rutas/ajustes'));
app.use('/auth', require('./rutas/cuenta'));
app.use('/usuarios', require('./rutas/usuarios_gestion'));
app.use('/sucursales', require('./rutas/sucursales_gestion'));
app.use('/catalogo', require('./rutas/catalogo_gestion'));
app.use('/renta-catalogo', require('./rutas/renta_catalogo_gestion'));
app.use('/proveedores', require('./rutas/proveedores_gestion'));
app.use('/clientes', require('./rutas/clientes'));
app.use('/clientes', require('./rutas/clientes_gestion'));
app.use(require('./middleware/errores').manejarErrores);

app.listen(process.env.PORT || 3000, (err) => {
  if (err) { console.error('No se pudo iniciar el servidor:', err.message); process.exit(1); }
  console.log('Servidor en http://localhost:' + (process.env.PORT || 3000));
});
