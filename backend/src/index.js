require('dotenv').config();
const express = require('express');
const pool = require('./db');

if (!process.env.JWT_SECRET) { console.error('Falta JWT_SECRET en .env'); process.exit(1); }

const app = express();
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
app.use('/catalogo', require('./rutas/catalogo'));
app.use(require('./middleware/errores').manejarErrores);

app.listen(3000, () => console.log('Servidor en http://localhost:3000'));
