BEGIN;

CREATE TABLE IF NOT EXISTS permiso (
  codigo      varchar(60) PRIMARY KEY,
  descripcion text NOT NULL
);

CREATE TABLE IF NOT EXISTS rol_permiso (
  categoria_empleado_id bigint      NOT NULL REFERENCES categoria_empleado(id),
  permiso_codigo        varchar(60) NOT NULL REFERENCES permiso(codigo),
  PRIMARY KEY (categoria_empleado_id, permiso_codigo)
);

INSERT INTO categoria_empleado (nombre, descripcion, nivel_poder) VALUES
  ('vendedor',      'Ventas, pagos, clientes y contratos de renta', 30),
  ('bodega',        'Recibe compras y gestiona movimientos de inventario', 20),
  ('mantenimiento', 'Actualiza el estado físico de las piezas de renta', 10)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permiso (codigo, descripcion) VALUES
  ('catalogo.ver',            'Consultar el catálogo de venta'),
  ('catalogo.editar',         'Crear y editar categorías y productos'),
  ('precios.editar',          'Cambiar precios y stock mínimo'),
  ('inventario.ver',          'Consultar stock, lotes y kardex'),
  ('inventario.ajustar',      'Ajustes, bajas y conteos de inventario'),
  ('compras.ver',             'Consultar compras'),
  ('compras.gestionar',       'Crear, recibir y anular compras'),
  ('ventas.gestionar',        'Crear y confirmar ventas, registrar pagos'),
  ('clientes.crear',          'Crear clientes'),
  ('clientes.editar',         'Editar, bloquear y desactivar clientes'),
  ('proveedores.gestionar',   'Crear y editar proveedores'),
  ('notas_credito.gestionar', 'Notas crédito, reingresos y reembolsos'),
  ('rentas.consultar',        'Consultar rentas y piezas'),
  ('rentas.operar',           'Abrir rentas, devoluciones, cobros y cierre'),
  ('rentas.catalogo',         'Crear productos y piezas de renta'),
  ('rentas.estado_piezas',    'Cambiar el estado físico de las piezas'),
  ('informes.ver',            'Ver informes'),
  ('informes.cuadre',         'Ver el cuadre general'),
  ('usuarios.gestionar',      'Crear y editar usuarios'),
  ('sucursales.gestionar',    'Crear y editar sucursales')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (categoria_empleado_id, permiso_codigo)
SELECT c.id, p.codigo
FROM categoria_empleado c, permiso p
WHERE c.nombre = 'owner'
   OR (c.nombre = 'admin_sucursal'
       AND p.codigo NOT IN ('sucursales.gestionar', 'informes.cuadre'))
   OR (c.nombre = 'vendedor'
       AND p.codigo IN ('catalogo.ver','inventario.ver','ventas.gestionar','clientes.crear','rentas.operar','rentas.consultar'))
   OR (c.nombre = 'bodega'
       AND p.codigo IN ('catalogo.ver','inventario.ver','inventario.ajustar','compras.ver','compras.gestionar'))
   OR (c.nombre = 'mantenimiento'
       AND p.codigo IN ('rentas.consultar','rentas.estado_piezas'))
ON CONFLICT DO NOTHING;

GRANT SELECT ON permiso, rol_permiso TO inventario_app;

COMMIT;
