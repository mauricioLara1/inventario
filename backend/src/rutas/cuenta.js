const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requiereLogin } = require('../middleware/auth');
const { registrar } = require('../auditoria');

// Cuenta propia: cada usuario cambia su clave (se monta en /auth).
const router = express.Router();

router.post('/cambiar-clave', requiereLogin, async (req, res, next) => {
  const { clave_actual: actual, clave_nueva: nueva } = req.body || {};
  if (typeof actual !== 'string' || typeof nueva !== 'string' || !actual || !nueva) {
    return res.status(400).json({ error: 'Faltan clave_actual y clave_nueva' });
  }
  if (nueva.length < 10) return res.status(400).json({ error: 'La clave nueva debe tener minimo 10 caracteres' });
  if (nueva === actual) return res.status(400).json({ error: 'La clave nueva debe ser distinta de la actual' });
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT clave_hash FROM usuario WHERE id = $1', [req.usuario.id]);
    if (!r.rows[0] || !(await bcrypt.compare(actual, r.rows[0].clave_hash))) {
      return res.status(403).json({ error: 'La clave actual no es correcta' });
    }
    const hash = await bcrypt.hash(nueva, 12);
    await client.query('BEGIN');
    await client.query('UPDATE usuario SET clave_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
    await registrar(client, {
      usuarioId: req.usuario.id, sucursalId: null, accion: 'cambiar_clave',
      tabla: 'usuario', registroId: req.usuario.id, detalle: {} });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
