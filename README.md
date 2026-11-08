# Inventario

Sistema modular de inventario y gestión de productos: compras, ventas,
rentas, notas crédito, bajas y ajustes, con usuarios, permisos por rol y
sucursal, informes y auditoría.

## Estado
Backend completo y probado. Frontend (React + Vite) pendiente.

## Stack
Node + Express · PostgreSQL 17 (Docker) · React + Vite (pendiente)

## Arquitectura
Monolito modular: una app, una base de datos. Las reglas de negocio viven
en PostgreSQL (triggers, funciones y vistas); el backend las traduce a HTTP.
Ver `docs/arquitectura.md`.

## Módulos del backend (`backend/src/rutas/`)
- Acceso: login, cambio de clave, usuarios, sucursales (roles: owner, admin_sucursal)
- Catálogo: categorías y productos de venta y de renta
- Inventario: compras, kardex por lote, bajas y ajustes
- Ventas y notas crédito
- Rentas: piezas físicas, depósito, devoluciones, cargos, cierre
- Informes: ventas, márgenes, stock bajo, por vencer, rentas vencidas, cuadre

## Seguridad
JWT validado contra la base en cada petición (desactivar un usuario corta
su sesión al instante), helmet, CORS por lista blanca (`CORS_ORIGINS`),
freno de intentos fallidos en el login, gitleaks en pre-commit y auditoría.

## Puesta en marcha
1. Base de datos: `docker compose up -d`
2. Servidor: `cd backend && node src/index.js` (puerto 3000, o `PORT`)
3. Pruebas: `cd backend && npm test`
   (recrea `inventario_test` y levanta un servidor aparte; nunca toca la base real)

## Hoja de ruta
- Pruebas de ventas, compras, notas crédito y ajustes
- Frontend y despliegue

## Convenciones
- Ramas: `feat/`, `fix/`, `docs/`, `chore/` desde `main`, merge por Pull Request
- Commits: Conventional Commits
- Versiones: tags semánticos (`v0.1.0`)

## Frontend

```bash
cd frontend
npm install        # solo la primera vez
npm run dev        # http://localhost:5173
```

El backend debe estar corriendo (por defecto en `http://localhost:3000`). Para otra dirección: variable `VITE_API_URL`.

## Roles y permisos

Cada rol es un paquete de permisos (tablas `permiso` y `rol_permiso`). Las rutas del backend piden permisos, no niveles.

| Rol | Alcance |
|---|---|
| owner | Todo el negocio: sucursales, usuarios, configuración y todos los módulos |
| gerente | Administra sus sucursales: usuarios de menor nivel, catálogo, precios, compras, ventas, inventario, rentas e informes |
| vendedor | Ventas, pagos, clientes y contratos de renta; consulta catálogo y stock |
| bodega | Recibe compras y ajusta inventario con motivo; consulta compras, lotes y kardex |
| mantenimiento | Consulta piezas de renta y cambia su estado físico |

Quien crea usuarios solo puede asignar roles de **nivel menor** al suyo (el owner puede asignar cualquiera).

## Migraciones

Los cambios de base de datos posteriores a `schema.sql` viven en `backend/db/migrations/` (son idempotentes). Las pruebas las aplican solas. En la base real:

```bash
docker exec -i inventario_db psql -v ON_ERROR_STOP=1 -U inventario_owner -d inventario < backend/db/migrations/001_roles_permisos.sql
```
