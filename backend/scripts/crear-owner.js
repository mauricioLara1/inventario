require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let oculto = false;
const escribir = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => { if (!oculto) escribir(s); };

const preguntar = (texto, secreto = false) =>
  new Promise((ok) => {
    rl.question(texto, (r) => { oculto = false; if (secreto) console.log(); ok(r.trim()); });
    oculto = secreto;
  });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM usuario');
    if (rows[0].n > 0) throw new Error('Ya existen usuarios. Este script solo sirve para el arranque inicial.');

    const sucursal = await preguntar('Nombre de la primera sucursal: ');
    const nombre = await preguntar('Tu nombre completo: ');
    const login = await preguntar('Usuario para entrar: ');
    const clave = await preguntar('Contrasena (minimo 10 caracteres): ', true);
    if (clave.length < 10) throw new Error('La contrasena es muy corta.');
    const hash = await bcrypt.hash(clave, 12);

    await client.query('BEGIN');
    const s = await client.query('INSERT INTO sucursal (nombre) VALUES ($1) RETURNING id', [sucursal]);
    const u = await client.query(
      `INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
       VALUES ($1, $2, $3, (SELECT id FROM categoria_empleado WHERE nombre = 'owner')) RETURNING id`,
      [nombre, login, hash]);
    await client.query('INSERT INTO sucursal_usuario (usuario_id, sucursal_id) VALUES ($1, $2)', [u.rows[0].id, s.rows[0].id]);
    await client.query(
      `INSERT INTO auditoria (usuario_id, sucursal_id, accion, tabla, registro_id, detalle)
       VALUES (NULL, $1, 'arranque_inicial', 'usuario', $2, '{"nota":"owner creado por script"}')`,
      [s.rows[0].id, u.rows[0].id]);
    await client.query('COMMIT');
    console.log('Listo: sucursal y owner creados.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error:', e.message);
  } finally {
    client.release(); await pool.end(); rl.close();
  }
})();
