# Inventario

Sistema modular de inventario y gestión de productos: entradas y salidas,
compras, ventas y rentas, con usuarios, permisos por rol y sucursal, y auditoría.

## Estado
Fase 0: fundamentos.

## Stack
React + Vite · Node + Express · PostgreSQL · Docker

## Arquitectura
Monolito modular: una app, una base de datos, módulos con reglas de
dependencia claras. Ver `docs/arquitectura.md`.

## Hoja de ruta
- Fase 1: núcleo e inventario
- Fase 2: compras y ventas
- Fase 3: rentas

## Convenciones
- Ramas: `feat/`, `fix/`, `docs/`, `chore/` desde `main`, merge por Pull Request
- Commits: Conventional Commits
- Versiones: tags semánticos (`v0.1.0`)
