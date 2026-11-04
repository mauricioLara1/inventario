-- ============================================================================
-- SEED BASE: catalogos que el sistema necesita en cualquier entorno.
-- Ejecutar despues de schema.sql. El owner y la primera sucursal NO se crean
-- aqui: los crea el script de arranque del backend (la clave se guarda con hash).
-- ============================================================================

BEGIN;

INSERT INTO categoria_empleado (nombre, descripcion, nivel_poder) VALUES
    ('owner',          'Dueno del negocio: todo, en todas las sucursales', 100),
    ('admin_sucursal', 'Administra una o varias sucursales asignadas',      50);

INSERT INTO formato_cobro (nombre, minutos_periodo) VALUES
    ('hora',   60),
    ('dia',    1440),
    ('semana', 10080);

INSERT INTO concepto_cargo_renta (nombre, descripcion) VALUES
    ('Dano',     'Dano a la pieza rentada'),
    ('Retraso',  'Cargo por entrega tardia'),
    ('Perdida',  'Pieza perdida: se cobra la reposicion'),
    ('Limpieza', 'La pieza se devolvio sucia'),
    ('Otro',     'Otro cargo (explicar en la descripcion)');

COMMIT;
