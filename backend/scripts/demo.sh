#!/bin/bash
# Recrea la base DEMO (inventario_demo) desde cero y la llena con datos de ejemplo.
# NUNCA toca la base real (inventario). Se puede repetir las veces que quieras.
set -e
cd "$(dirname "$0")/.."
D=$(cd ../db && pwd)
read -rs -p "Clave para los usuarios demo (mínimo 10 caracteres, no se muestra): " DEMO_CLAVE
echo
if [ ${#DEMO_CLAVE} -lt 10 ]; then echo "Mínimo 10 caracteres"; exit 1; fi
export DEMO_CLAVE
PSQL="docker exec -i inventario_db psql -v ON_ERROR_STOP=1 -q"
$PSQL -U postgres -d postgres -c "DROP DATABASE IF EXISTS inventario_demo WITH (FORCE)" -c "CREATE DATABASE inventario_demo OWNER inventario_owner"
$PSQL -U inventario_owner -d inventario_demo < "$D/schema.sql" > /dev/null
$PSQL -U inventario_owner -d inventario_demo < "$D/seed.sql" > /dev/null
for f in "$D"/../backend/db/migrations/*.sql; do $PSQL -U inventario_owner -d inventario_demo < "$f" > /dev/null; done
$PSQL -U inventario_owner -d inventario_demo -c "GRANT USAGE ON SCHEMA public TO inventario_app" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inventario_app"
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.env.DEMO_CLAVE, 10))")
$PSQL -U inventario_owner -d inventario_demo -v hash="$HASH" <<'SQL'
INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
SELECT 'Dueño Demo', 'demo_owner', :'hash', id FROM categoria_empleado WHERE nombre = 'owner';
SQL
echo "Base demo lista. Cargando datos..."
node scripts/demo.js
