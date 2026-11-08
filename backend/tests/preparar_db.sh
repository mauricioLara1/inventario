#!/bin/sh
# Recrea la base de PRUEBAS (inventario_test) desde cero. Nunca toca la base real.
set -e
D=$(cd "$(dirname "$0")/../../db" && pwd)
PSQL="docker exec -i inventario_db psql -v ON_ERROR_STOP=1 -q"
$PSQL -U postgres -d postgres -c "DROP DATABASE IF EXISTS inventario_test WITH (FORCE)" -c "CREATE DATABASE inventario_test OWNER inventario_owner"
$PSQL -U inventario_owner -d inventario_test < "$D/schema.sql" > /dev/null
$PSQL -U inventario_owner -d inventario_test < "$D/seed.sql" > /dev/null
for f in "$D"/../backend/db/migrations/*.sql; do $PSQL -U inventario_owner -d inventario_test < "$f" > /dev/null; done
$PSQL -U inventario_owner -d inventario_test -c "GRANT USAGE ON SCHEMA public TO inventario_app" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inventario_app"
echo "inventario_test lista"
