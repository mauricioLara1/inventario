require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.get('/salud', async (req, res) => {
  try {
    const r = await pool.query('SELECT count(*)::int AS categorias FROM categoria_empleado');
    res.json({ ok: true, categorias: r.rows[0].categorias });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(3000, () => console.log('Servidor en http://localhost:3000'));
