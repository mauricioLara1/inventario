// Registra un evento en la tabla auditoria. Recibe un cliente (para ir dentro de la misma transaccion).
async function registrar(client, { usuarioId, sucursalId = null, accion, tabla, registroId = null, detalle = null }) {
  await client.query(
    `INSERT INTO auditoria (usuario_id, sucursal_id, accion, tabla, registro_id, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [usuarioId, sucursalId, accion, tabla, registroId, detalle ? JSON.stringify(detalle) : null]);
}
module.exports = { registrar };
