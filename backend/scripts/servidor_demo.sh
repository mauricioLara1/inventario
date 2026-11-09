#!/bin/bash
# Arranca el backend apuntando a la base DEMO (la real no se toca).
cd "$(dirname "$0")/.."
export DATABASE_URL=$(node -e "require('dotenv').config({quiet:true});const u=new URL(process.env.DATABASE_URL);u.pathname='/inventario_demo';console.log(u.toString())")
echo "Servidor sobre la base DEMO (inventario_demo). Ctrl+C para parar."
exec node src/index.js
