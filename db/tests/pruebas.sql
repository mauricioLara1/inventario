-- ============================================================================
-- PRUEBAS DE LA BASE DE DATOS
-- Usar SOLO en una base vacia de pruebas, despues de schema.sql y seed.sql:
--   createdb inventario_test
--   psql -v ON_ERROR_STOP=1 -d inventario_test -f schema.sql
--   psql -v ON_ERROR_STOP=1 -d inventario_test -f seed.sql
--   psql -v ON_ERROR_STOP=1 -d inventario_test -f tests/pruebas.sql
-- Cada prueba imprime OK o aborta con FALLO. Al final imprime el resumen.
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;

-- Ayudas (viven solo en esta sesion).
CREATE FUNCTION pg_temp.ok(p_desc TEXT, p_cond BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLO: %', p_desc; END IF;
    RAISE NOTICE 'OK    %', p_desc;
END; $$;

-- Ejecuta p_sql, fuerza las validaciones diferidas y REVIERTE todo. La prueba pasa
-- si p_sql falla (y, si se indica, con ese SQLSTATE o ese texto en el mensaje).
CREATE FUNCTION pg_temp.debe_fallar(p_desc TEXT, p_sql TEXT, p_estado TEXT DEFAULT NULL,
                                    p_texto TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_msg TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
        EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
        RAISE EXCEPTION USING ERRCODE = 'XX999', MESSAGE = 'NO_FALLO';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'XX999' THEN
            RAISE EXCEPTION 'FALLO (debia ser rechazado): %', p_desc;
        END IF;
        IF p_estado IS NOT NULL AND SQLSTATE <> p_estado THEN
            RAISE EXCEPTION 'FALLO (codigo %, esperado %): % -> %', SQLSTATE, p_estado, p_desc, SQLERRM;
        END IF;
        IF p_texto IS NOT NULL AND position(p_texto IN SQLERRM) = 0 THEN
            RAISE EXCEPTION 'FALLO (mensaje inesperado): % -> %', p_desc, SQLERRM;
        END IF;
        v_msg := SQLERRM;
    END;
    RAISE NOTICE 'OK    rechazado: %  [%]', p_desc, left(v_msg, 70);
END; $$;

-- ---------------------------------------------------------------------------
-- 0. Datos de prueba
-- ---------------------------------------------------------------------------
INSERT INTO sucursal (nombre) VALUES ('Principal'), ('Norte');
INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
SELECT 'Owner prueba', 'owner', '!sin-clave!', id FROM categoria_empleado WHERE nombre = 'owner';
INSERT INTO usuario (nombre, usuario, clave_hash, categoria_empleado_id)
SELECT 'Admin prueba', 'admin', '!sin-clave!', id FROM categoria_empleado WHERE nombre = 'admin_sucursal';
INSERT INTO sucursal_usuario SELECT u.id, s.id FROM usuario u, sucursal s WHERE u.usuario = 'admin' AND s.nombre = 'Principal';

INSERT INTO categoria_producto (nombre) VALUES ('Lacteos'), ('Ferreteria');
INSERT INTO producto (categoria_producto_id, codigo, nombre, maneja_caducidad, impuesto_porcentaje)
SELECT id, 'LEC-001', 'Leche entera 1 L', TRUE, 0 FROM categoria_producto WHERE nombre = 'Lacteos';
INSERT INTO producto (categoria_producto_id, codigo, nombre, maneja_caducidad, impuesto_porcentaje)
SELECT id, 'TOR-001', 'Tornillo 1 pulgada', FALSE, 19 FROM categoria_producto WHERE nombre = 'Ferreteria';
INSERT INTO producto_sucursal (producto_id, sucursal_id, precio_venta, stock_minimo)
SELECT p.id, s.id, CASE p.codigo WHEN 'LEC-001' THEN 4500 ELSE 100 END,
                   CASE p.codigo WHEN 'LEC-001' THEN 10 ELSE 50 END
  FROM producto p, sucursal s WHERE s.nombre = 'Principal';
INSERT INTO proveedor (nombre, nit) VALUES ('Lacteos del Valle', '900000001'), ('Ferretodo', '900000002');
INSERT INTO cliente (nombre, tipo_documento, numero_documento, telefono)
VALUES ('Cliente con telefono', 'CC', '1001', '3001112233');
INSERT INTO cliente (nombre, tipo_documento, numero_documento)
VALUES ('Cliente sin telefono', 'CC', '1002');
INSERT INTO cliente (nombre, tipo_documento, numero_documento, telefono, bloqueado, motivo_bloqueo)
VALUES ('Cliente bloqueado', 'CC', '1003', '3009998877', TRUE, 'No devolvio una pieza');

-- ---------------------------------------------------------------------------
-- 1. Compras, lotes y kardex
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_s    BIGINT := (SELECT id FROM sucursal WHERE nombre = 'Principal');
    v_prov BIGINT := (SELECT id FROM proveedor WHERE nit = '900000001');
    v_prov2 BIGINT := (SELECT id FROM proveedor WHERE nit = '900000002');
    v_lec  BIGINT := (SELECT id FROM producto WHERE codigo = 'LEC-001');
    v_tor  BIGINT := (SELECT id FROM producto WHERE codigo = 'TOR-001');
    v_c    BIGINT;
BEGIN
    INSERT INTO compra (sucursal_id, proveedor_id, recibida_por, numero_factura_proveedor)
    VALUES (v_s, v_prov, v_user, 'F-100') RETURNING id INTO v_c;
    INSERT INTO compra_detalle (compra_id, sucursal_id, producto_id, cantidad, costo_unitario, fecha_caducidad)
    VALUES (v_c, v_s, v_lec, 50, 3000, CURRENT_DATE + 2),
           (v_c, v_s, v_lec, 30, 3200, CURRENT_DATE + 13),
           (v_c, v_s, v_lec, 20, 2900, CURRENT_DATE - 1);       -- lote ya vencido
    PERFORM pg_temp.ok('compra en borrador no crea lotes todavia', (SELECT count(*) FROM lote) = 0);
    UPDATE compra SET estado = 'recibida' WHERE id = v_c;
    PERFORM pg_temp.ok('recibir la compra crea 3 lotes con su saldo', (SELECT count(*) FROM lote_saldo) = 3);
    PERFORM pg_temp.ok('saldo de cada lote = cantidad comprada',
        (SELECT sum(cantidad_actual) FROM lote_saldo) = 100);
    PERFORM pg_temp.ok('numero asignado solo: C-00001', (SELECT numero FROM compra WHERE id = v_c) = 'C-00001');

    INSERT INTO compra (sucursal_id, proveedor_id, recibida_por) VALUES (v_s, v_prov2, v_user) RETURNING id INTO v_c;
    INSERT INTO compra_detalle (compra_id, sucursal_id, producto_id, cantidad, costo_unitario)
    VALUES (v_c, v_s, v_tor, 200, 50);
    PERFORM pg_temp.ok('IVA del producto copiado a la linea (19)',
        (SELECT impuesto_porcentaje FROM compra_detalle WHERE compra_id = v_c) = 19);
    PERFORM pg_temp.ok('total de compra = suma de lineas con IVA (10000 + 1900)',
        (SELECT total FROM v_compra_totales WHERE compra_id = v_c) = 11900);
    UPDATE compra SET estado = 'recibida' WHERE id = v_c;
END $$;

SELECT pg_temp.debe_fallar('producto con caducidad exige fecha en la linea',
  $q$ WITH c AS (INSERT INTO compra (sucursal_id, proveedor_id, recibida_por)
        SELECT s.id, p.id, u.id FROM sucursal s, proveedor p, usuario u
         WHERE s.nombre='Principal' AND p.nit='900000001' AND u.usuario='admin' RETURNING id, sucursal_id)
     INSERT INTO compra_detalle (compra_id, sucursal_id, producto_id, cantidad, costo_unitario)
     SELECT c.id, c.sucursal_id, (SELECT id FROM producto WHERE codigo='LEC-001'), 5, 3000 FROM c $q$,
  NULL, 'exige fecha de caducidad');
SELECT pg_temp.debe_fallar('compra sin lineas no se puede recibir',
  $q$ INSERT INTO compra (sucursal_id, proveedor_id, recibida_por, numero_factura_proveedor)
      SELECT s.id, p.id, u.id, 'F-SIN-LINEAS' FROM sucursal s, proveedor p, usuario u
       WHERE s.nombre='Principal' AND p.nit='900000001' AND u.usuario='admin';
      UPDATE compra SET estado='recibida' WHERE numero_factura_proveedor='F-SIN-LINEAS' $q$, NULL, 'no tiene lineas');
SELECT pg_temp.debe_fallar('factura de proveedor repetida',
  $q$ INSERT INTO compra (sucursal_id, proveedor_id, recibida_por, numero_factura_proveedor)
      SELECT s.id, p.id, u.id, 'F-100' FROM sucursal s, proveedor p, usuario u
       WHERE s.nombre='Principal' AND p.nit='900000001' AND u.usuario='admin' $q$, '23505');
SELECT pg_temp.debe_fallar('producto no habilitado en esa sucursal',
  $q$ WITH c AS (INSERT INTO compra (sucursal_id, proveedor_id, recibida_por)
        SELECT s.id, p.id, u.id FROM sucursal s, proveedor p, usuario u
         WHERE s.nombre='Norte' AND p.nit='900000002' AND u.usuario='admin' RETURNING id, sucursal_id)
     INSERT INTO compra_detalle (compra_id, sucursal_id, producto_id, cantidad, costo_unitario)
     SELECT c.id, c.sucursal_id, (SELECT id FROM producto WHERE codigo='TOR-001'), 5, 50 FROM c $q$, NULL, 'no esta habilitado');
SELECT pg_temp.debe_fallar('lote creado a mano',
  $q$ INSERT INTO lote (compra_detalle_id, sucursal_id, producto_id, costo_unitario, cantidad_inicial, fecha_compra)
      SELECT d.id, d.sucursal_id, d.producto_id, 1, 1, now() FROM compra_detalle d LIMIT 1 $q$,
  NULL, 'no se crean a mano');
SELECT pg_temp.debe_fallar('movimiento de compra insertado a mano',
  $q$ INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
      SELECT id, sucursal_id, producto_id, 'compra', 5, (SELECT id FROM usuario LIMIT 1) FROM lote LIMIT 1 $q$,
  NULL, 'los genera la compra');
SELECT pg_temp.debe_fallar('editar un movimiento del kardex',
  $q$ UPDATE movimiento SET cantidad_con_signo = 1 WHERE id = (SELECT min(id) FROM movimiento) $q$, NULL, 'historica');
SELECT pg_temp.debe_fallar('borrar un movimiento del kardex',
  $q$ DELETE FROM movimiento WHERE id = (SELECT min(id) FROM movimiento) $q$, NULL, 'historica');
SELECT pg_temp.debe_fallar('cambiar el saldo de un lote a mano',
  $q$ UPDATE lote_saldo SET cantidad_actual = 999 $q$, NULL, 'no se modifica a mano');
SELECT pg_temp.debe_fallar('editar una linea de una compra ya recibida',
  $q$ UPDATE compra_detalle SET cantidad = 1 $q$, NULL, 'no se modifican');
SELECT pg_temp.debe_fallar('cambiar una compra recibida',
  $q$ UPDATE compra SET numero_factura_proveedor = 'X' WHERE numero = 'C-00001' $q$, NULL, 'anulandola');
SELECT pg_temp.debe_fallar('ajuste sin motivo',
  $q$ INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
      SELECT id, sucursal_id, producto_id, 'ajuste', 1, (SELECT id FROM usuario LIMIT 1) FROM lote LIMIT 1 $q$, '23514');
SELECT pg_temp.debe_fallar('baja que dejaria el saldo negativo (INV01)',
  $q$ INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, motivo, usuario_id)
      SELECT id, sucursal_id, producto_id, 'baja', -9999, 'danado', (SELECT id FROM usuario LIMIT 1) FROM lote LIMIT 1 $q$, 'INV01');

-- ---------------------------------------------------------------------------
-- 2. Ventas, FEFO, notas credito y pagos
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_s    BIGINT := (SELECT id FROM sucursal WHERE nombre = 'Principal');
    v_lec  BIGINT := (SELECT id FROM producto WHERE codigo = 'LEC-001');
    v_cli  BIGINT := (SELECT id FROM cliente WHERE numero_documento = '1001');
    v_v    BIGINT;
BEGIN
    INSERT INTO venta (sucursal_id, cliente_id, vendedor_id) VALUES (v_s, v_cli, v_user) RETURNING id INTO v_v;
    INSERT INTO venta_detalle (venta_id, sucursal_id, producto_id, cantidad) VALUES (v_v, v_s, v_lec, 60);
    PERFORM pg_temp.ok('precio copiado del catalogo (4500) y total de la linea 270000',
        (SELECT total FROM venta_detalle WHERE venta_id = v_v) = 270000);
    PERFORM confirmar_venta(v_v, v_user);
    PERFORM pg_temp.ok('venta confirmada con numero V-00001',
        (SELECT estado || numero FROM venta WHERE id = v_v) = 'confirmadaV-00001');
    PERFORM pg_temp.ok('FEFO: salieron 50 del lote que vence antes y 10 del siguiente',
        (SELECT string_agg(abs(m.cantidad_con_signo)::TEXT, ',' ORDER BY l.fecha_caducidad)
           FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id JOIN lote l ON l.id = m.lote_id) = '50.000,10.000');
    PERFORM pg_temp.ok('el lote vencido no se toco (20)',
        (SELECT s.cantidad_actual FROM lote l JOIN lote_saldo s ON s.lote_id = l.id
          WHERE l.fecha_caducidad < CURRENT_DATE) = 20);
    PERFORM pg_temp.ok('v_stock: leche vendible = 20 y vencida = 20',
        (SELECT cantidad_vendible || '/' || cantidad_vencida FROM v_stock WHERE producto_id = v_lec AND sucursal_id = v_s) = '20.000/20.000');
    PERFORM pg_temp.ok('v_stock: stock_bajo falso (20 vendibles > minimo 10)',
        (SELECT stock_bajo FROM v_stock WHERE producto_id = v_lec AND sucursal_id = v_s) = FALSE);
END $$;

SELECT pg_temp.debe_fallar('vender mas de lo disponible y vendible (INV01)',
  $q$ INSERT INTO venta (sucursal_id, vendedor_id, numero)
      SELECT s.id, u.id, 'V-TEST' FROM sucursal s, usuario u WHERE s.nombre='Principal' AND u.usuario='admin';
      INSERT INTO venta_detalle (venta_id, sucursal_id, producto_id, cantidad)
      SELECT v.id, v.sucursal_id, (SELECT id FROM producto WHERE codigo='LEC-001'), 21 FROM venta v WHERE numero='V-TEST';
      SELECT confirmar_venta((SELECT id FROM venta WHERE numero='V-TEST'), (SELECT id FROM usuario WHERE usuario='admin')) $q$, 'INV01');
SELECT pg_temp.debe_fallar('confirmar una venta sin lineas',
  $q$ INSERT INTO venta (sucursal_id, vendedor_id, numero)
      SELECT s.id, u.id, 'V-TEST' FROM sucursal s, usuario u WHERE s.nombre='Principal' AND u.usuario='admin';
      SELECT confirmar_venta((SELECT id FROM venta WHERE numero='V-TEST'), (SELECT id FROM usuario WHERE usuario='admin')) $q$, NULL, 'no tiene lineas');
SELECT pg_temp.debe_fallar('marcar confirmada sin descontar stock',
  $q$ INSERT INTO venta (sucursal_id, vendedor_id, numero)
      SELECT s.id, u.id, 'V-TEST' FROM sucursal s, usuario u WHERE s.nombre='Principal' AND u.usuario='admin';
      INSERT INTO venta_detalle (venta_id, sucursal_id, producto_id, cantidad)
      SELECT v.id, v.sucursal_id, (SELECT id FROM producto WHERE codigo='LEC-001'), 1 FROM venta v WHERE numero='V-TEST';
      UPDATE venta SET estado='confirmada' WHERE numero='V-TEST' $q$, NULL, 'con lote asignado');
SELECT pg_temp.debe_fallar('movimiento de venta suelto (sin linea de venta)',
  $q$ INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
      SELECT l.id, l.sucursal_id, l.producto_id, 'venta', -1, (SELECT id FROM usuario LIMIT 1)
        FROM lote l JOIN lote_saldo s ON s.lote_id = l.id WHERE s.cantidad_actual > 0 LIMIT 1 $q$, NULL, 'no esta asignado');
SELECT pg_temp.debe_fallar('editar una venta confirmada',
  $q$ UPDATE venta SET estado = 'borrador' WHERE numero = 'V-00001' $q$, NULL, 'confirmada');
SELECT pg_temp.debe_fallar('editar una linea de venta confirmada',
  $q$ UPDATE venta_detalle SET cantidad = 1 $q$, NULL, 'no se modifican');
SELECT pg_temp.debe_fallar('borrar una venta confirmada',
  $q$ DELETE FROM venta WHERE numero = 'V-00001' $q$, NULL, 'no se borra');

-- Pagos y notas credito sobre V-00001 (total 270000).
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_v    BIGINT := (SELECT id FROM venta WHERE numero = 'V-00001');
    v_s    BIGINT := (SELECT sucursal_id FROM venta WHERE numero = 'V-00001');
    v_vd   BIGINT := (SELECT id FROM venta_detalle WHERE venta_id = (SELECT id FROM venta WHERE numero = 'V-00001'));
    v_nc   BIGINT;
    v_ncd  BIGINT;
BEGIN
    INSERT INTO venta_pago (venta_id, tipo, metodo, monto, usuario_id) VALUES (v_v, 'pago', 'efectivo', 200000, v_user);
    PERFORM pg_temp.ok('saldo de la venta = 70000', (SELECT saldo FROM v_venta_saldo WHERE venta_id = v_v) = 70000);
    PERFORM pg_temp.debe_fallar('pago mayor a la deuda',
        format($f$INSERT INTO venta_pago (venta_id, tipo, metodo, monto, usuario_id) VALUES (%s,'pago','efectivo',70001,%s)$f$, v_v, v_user),
        NULL, 'excede lo que se debe');
    INSERT INTO venta_pago (venta_id, tipo, metodo, monto, usuario_id) VALUES (v_v, 'pago', 'tarjeta', 70000, v_user);

    -- Nota credito por 10 unidades.
    INSERT INTO nota_credito (venta_id, sucursal_id, emitida_por, motivo) VALUES (v_v, v_s, v_user, 'Producto en mal estado') RETURNING id INTO v_nc;
    INSERT INTO nota_credito_detalle (nota_credito_id, venta_id, sucursal_id, venta_detalle_id, cantidad)
    VALUES (v_nc, v_v, v_s, v_vd, 10) RETURNING id INTO v_ncd;
    PERFORM pg_temp.ok('importes de la nota calculados en proporcion (45000)',
        (SELECT total FROM nota_credito_detalle WHERE id = v_ncd) = 45000);
    PERFORM pg_temp.debe_fallar('acreditar mas de lo vendido',
        format($f$INSERT INTO nota_credito_detalle (nota_credito_id, venta_id, sucursal_id, venta_detalle_id, cantidad) VALUES (%s,%s,%s,%s,51)$f$, v_nc, v_v, v_s, v_vd),
        NULL, 'mas de lo vendido');
    PERFORM pg_temp.debe_fallar('reingresar stock con la nota aun en borrador',
        format($f$SELECT reingresar_stock(%s, 10, %s)$f$, v_ncd, v_user), NULL, 'confirmada');
    UPDATE nota_credito SET estado = 'confirmada' WHERE id = v_nc;
    PERFORM pg_temp.ok('numero de nota NC-00001', (SELECT numero FROM nota_credito WHERE id = v_nc) = 'NC-00001');
    PERFORM pg_temp.ok('la nota credito aun no mueve stock', (SELECT count(*) FROM nota_credito_reingreso) = 0);
    PERFORM pg_temp.ok('saldo de la venta = -45000 (hay que devolver dinero)',
        (SELECT saldo FROM v_venta_saldo WHERE venta_id = v_v) = -45000);

    PERFORM reingresar_stock(v_ncd, 10, v_user);
    PERFORM pg_temp.ok('reingreso devuelve 10 al lote del que salieron (el que vencia antes)',
        (SELECT s.cantidad_actual FROM lote l JOIN lote_saldo s ON s.lote_id = l.id
          WHERE l.fecha_caducidad = CURRENT_DATE + 2) = 10);
    PERFORM pg_temp.debe_fallar('reingresar mas de lo acreditado',
        format($f$SELECT reingresar_stock(%s, 1, %s)$f$, v_ncd, v_user), NULL, 'mas de lo acreditado');

    PERFORM pg_temp.debe_fallar('reembolso mayor a la nota',
        format($f$INSERT INTO venta_pago (venta_id, nota_credito_id, tipo, metodo, monto, usuario_id) VALUES (%s,%s,'reembolso','efectivo',45001,%s)$f$, v_v, v_nc, v_user),
        NULL, 'excede la nota');
    INSERT INTO venta_pago (venta_id, nota_credito_id, tipo, metodo, monto, usuario_id)
    VALUES (v_v, v_nc, 'reembolso', 'efectivo', 45000, v_user);
    PERFORM pg_temp.ok('saldo final de la venta = 0', (SELECT saldo FROM v_venta_saldo WHERE venta_id = v_v) = 0);
    PERFORM pg_temp.ok('margen: ingreso neto 225000, costo 152000, margen 73000',
        (SELECT ingreso_neto = 225000 AND costo = 152000 AND margen = 73000 FROM v_venta_margen WHERE venta_id = v_v));
END $$;

-- ---------------------------------------------------------------------------
-- 3. Anulacion de compras
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
BEGIN
    PERFORM pg_temp.debe_fallar('anular compra cuyo stock ya salio (INV02)',
        format($f$INSERT INTO compra_anulacion (compra_id, usuario_id, motivo) SELECT id, %s, 'prueba' FROM compra WHERE numero = 'C-00001'$f$, v_user),
        'INV02');
    INSERT INTO compra_anulacion (compra_id, usuario_id, motivo)
    SELECT id, v_user, 'Error de digitacion' FROM compra WHERE numero = 'C-00002';
    PERFORM pg_temp.ok('compra anulada: estado y stock en 0',
        (SELECT estado FROM compra WHERE numero = 'C-00002') = 'anulada'
        AND (SELECT s.cantidad_actual FROM lote l JOIN lote_saldo s ON s.lote_id = l.id
              WHERE l.producto_id = (SELECT id FROM producto WHERE codigo = 'TOR-001')) = 0);
    PERFORM pg_temp.debe_fallar('anular dos veces la misma compra',
        format($f$INSERT INTO compra_anulacion (compra_id, usuario_id, motivo) SELECT id, %s, 'otra' FROM compra WHERE numero = 'C-00002'$f$, v_user),
        '23505');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Rentas
-- ---------------------------------------------------------------------------
INSERT INTO categoria_renta (nombre) VALUES ('Escaleras');
INSERT INTO producto_renta (categoria_renta_id, codigo, nombre, formato_cobro_id, precio, deposito, reposicion)
SELECT c.id, 'ESC-3M', 'Escalera 3 m', f.id, 20000, 50000, 180000
  FROM categoria_renta c, formato_cobro f WHERE c.nombre = 'Escaleras' AND f.nombre = 'dia';
INSERT INTO unidad_renta (producto_renta_id, sucursal_id, codigo)
SELECT p.id, s.id, u.c FROM producto_renta p, sucursal s, (VALUES ('ESC-001'), ('ESC-002'), ('ESC-003')) u(c)
 WHERE p.codigo = 'ESC-3M' AND s.nombre = 'Principal';

SELECT pg_temp.debe_fallar('renta a un cliente sin telefono',
  $q$ INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
      SELECT s.id, c.id, u.id, now() + interval '1 day' FROM sucursal s, cliente c, usuario u
       WHERE s.nombre='Principal' AND c.numero_documento='1002' AND u.usuario='admin' $q$, NULL, 'telefono');
SELECT pg_temp.debe_fallar('renta a un cliente bloqueado',
  $q$ INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
      SELECT s.id, c.id, u.id, now() + interval '1 day' FROM sucursal s, cliente c, usuario u
       WHERE s.nombre='Principal' AND c.numero_documento='1003' AND u.usuario='admin' $q$, NULL, 'telefono');
SELECT pg_temp.debe_fallar('abrir renta sin cobrar el deposito exigido',
  $q$ WITH r AS (INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
        SELECT s.id, c.id, u.id, now() + interval '1 day' FROM sucursal s, cliente c, usuario u
         WHERE s.nombre='Principal' AND c.numero_documento='1001' AND u.usuario='admin' RETURNING id, sucursal_id)
     INSERT INTO renta_detalle (renta_id, sucursal_id, unidad_renta_id)
     SELECT r.id, r.sucursal_id, (SELECT id FROM unidad_renta WHERE codigo='ESC-001') FROM r $q$, NULL, 'exige deposito');
SELECT pg_temp.debe_fallar('abrir renta sin piezas',
  $q$ INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
      SELECT s.id, c.id, u.id, now() + interval '1 day' FROM sucursal s, cliente c, usuario u
       WHERE s.nombre='Principal' AND c.numero_documento='1001' AND u.usuario='admin' $q$, NULL, 'no tiene piezas');

-- Abrir R-00001 con 2 escaleras y 100000 de deposito.
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_s    BIGINT := (SELECT id FROM sucursal WHERE nombre = 'Principal');
    v_cli  BIGINT := (SELECT id FROM cliente WHERE numero_documento = '1001');
    v_r    BIGINT;
BEGIN
    INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
    VALUES (v_s, v_cli, v_user, now() + interval '3 days') RETURNING id INTO v_r;
    INSERT INTO renta_detalle (renta_id, sucursal_id, unidad_renta_id)
    SELECT v_r, v_s, id FROM unidad_renta WHERE codigo IN ('ESC-001', 'ESC-002');
    INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (v_r, 'deposito', 'efectivo', 100000, v_user);
END $$;

DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_r    BIGINT := (SELECT id FROM renta WHERE numero = 'R-00001');
    v_s    BIGINT := (SELECT sucursal_id FROM renta WHERE numero = 'R-00001');
    v_d1   BIGINT := (SELECT d.id FROM renta_detalle d JOIN unidad_renta u ON u.id = d.unidad_renta_id WHERE u.codigo = 'ESC-001');
    v_d2   BIGINT := (SELECT d.id FROM renta_detalle d JOIN unidad_renta u ON u.id = d.unidad_renta_id WHERE u.codigo = 'ESC-002');
    v_ini  TIMESTAMPTZ := (SELECT fecha_inicio FROM renta WHERE id = v_r);
    v_p    INTEGER;
BEGIN
    PERFORM pg_temp.ok('renta abierta: numero R-00001, tarifa y deposito copiados',
        (SELECT tarifa_aplicada || '/' || deposito_aplicado FROM renta_detalle WHERE id = v_d1) = '20000.00/50000.00');
    PERFORM pg_temp.ok('las dos piezas quedaron rentadas (la base las marco)',
        (SELECT count(*) FROM unidad_renta WHERE estado = 'rentada') = 2);
    PERFORM pg_temp.debe_fallar('rentar una pieza ya rentada',
        format($f$INSERT INTO renta_detalle (renta_id, sucursal_id, unidad_renta_id) SELECT %s, %s, id FROM unidad_renta WHERE codigo='ESC-001'$f$, v_r, v_s),
        NULL);
    PERFORM pg_temp.debe_fallar('cambiar a mano el estado "rentada" de una pieza',
        $f$UPDATE unidad_renta SET estado = 'disponible' WHERE codigo = 'ESC-001'$f$, NULL, 'rentada');
    PERFORM pg_temp.debe_fallar('cerrar la renta con piezas pendientes',
        format($f$SELECT cerrar_renta(%s, %s)$f$, v_r, v_user), NULL, 'pendientes');
    PERFORM pg_temp.debe_fallar('cobro adelantado (saldo 0)',
        format($f$INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (%s,'cobro','efectivo',1,%s)$f$, v_r, v_user),
        NULL, 'excede el saldo');

    -- Pieza 1: 2 dias y 10 minutos, gracia 30 -> 2 periodos. Pieza 2: danada a 1 dia.
    v_p := devolver_pieza(v_d1, 'devuelta', v_ini + interval '2 days 10 minutes', 30);
    PERFORM pg_temp.ok('2 dias + 10 min con 30 de gracia = 2 periodos', v_p = 2);
    PERFORM pg_temp.ok('periodos con 40 min de retraso y gracia 30 = 3',
        periodos_a_cobrar(v_ini, v_ini + interval '2 days 40 minutes', 1440, 30) = 3);
    PERFORM pg_temp.ok('devolver antes de un periodo cobra minimo 1',
        periodos_a_cobrar(v_ini, v_ini + interval '10 minutes', 1440, 0) = 1);
    PERFORM pg_temp.ok('la pieza devuelta vuelve a disponible',
        (SELECT estado FROM unidad_renta WHERE codigo = 'ESC-001') = 'disponible');
    PERFORM pg_temp.ok('total de la linea = 2 x 20000', (SELECT total FROM renta_detalle WHERE id = v_d1) = 40000);
    PERFORM pg_temp.debe_fallar('devolver dos veces la misma pieza',
        format($f$SELECT devolver_pieza(%s, 'devuelta')$f$, v_d1), NULL, 'no se modifica');

    PERFORM devolver_pieza(v_d2, 'danada', v_ini + interval '1 day', 0);
    PERFORM pg_temp.ok('la pieza danada pasa a mantenimiento',
        (SELECT estado FROM unidad_renta WHERE codigo = 'ESC-002') = 'mantenimiento');
    INSERT INTO renta_cargo (renta_detalle_id, concepto_cargo_id, descripcion, monto, usuario_id)
    SELECT v_d2, id, 'Peldano roto', 15000, v_user FROM concepto_cargo_renta WHERE nombre = 'Dano';
    PERFORM pg_temp.ok('saldo = 40000 + 20000 + 15000 = 75000',
        (SELECT saldo FROM v_renta_saldo WHERE renta_id = v_r) = 75000);
    PERFORM pg_temp.debe_fallar('cerrar con saldo pendiente',
        format($f$SELECT cerrar_renta(%s, %s)$f$, v_r, v_user), NULL, 'saldo');
    PERFORM pg_temp.debe_fallar('aplicar mas deposito del que hay',
        format($f$INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (%s,'aplicacion_deposito','efectivo',100001,%s)$f$, v_r, v_user),
        NULL, 'mas deposito');
    INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (v_r, 'aplicacion_deposito', 'efectivo', 75000, v_user);
    PERFORM pg_temp.debe_fallar('cerrar con deposito sin devolver (25000)',
        format($f$SELECT cerrar_renta(%s, %s)$f$, v_r, v_user), NULL, 'deposito');
    INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (v_r, 'devolucion_deposito', 'efectivo', 25000, v_user);
    PERFORM cerrar_renta(v_r, v_user);
    PERFORM pg_temp.ok('renta cerrada con cuenta en cero', (SELECT estado FROM renta WHERE id = v_r) = 'cerrada');
    PERFORM pg_temp.debe_fallar('cargo sobre una renta cerrada',
        format($f$INSERT INTO renta_cargo (renta_detalle_id, concepto_cargo_id, monto, usuario_id) VALUES (%s,(SELECT id FROM concepto_cargo_renta LIMIT 1),5,%s)$f$, v_d1, v_user),
        NULL, 'abierta');
    PERFORM pg_temp.debe_fallar('pago sobre una renta cerrada',
        format($f$INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (%s,'deposito','efectivo',5,%s)$f$, v_r, v_user),
        NULL, 'abierta');
    PERFORM pg_temp.debe_fallar('modificar una renta cerrada',
        format($f$UPDATE renta SET fecha_prevista_devolucion = now() + interval '9 days' WHERE id = %s$f$, v_r), NULL, 'cerrada');
    PERFORM pg_temp.debe_fallar('borrar un pago de renta',
        $f$DELETE FROM renta_pago$f$, NULL, 'historica');
END $$;

-- Cancelar una renta (R-00002): primero hay que devolver el deposito.
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_s    BIGINT := (SELECT id FROM sucursal WHERE nombre = 'Principal');
    v_cli  BIGINT := (SELECT id FROM cliente WHERE numero_documento = '1001');
    v_r    BIGINT;
BEGIN
    INSERT INTO renta (sucursal_id, cliente_id, usuario_abre_id, fecha_prevista_devolucion)
    VALUES (v_s, v_cli, v_user, now() + interval '1 day') RETURNING id INTO v_r;
    INSERT INTO renta_detalle (renta_id, sucursal_id, unidad_renta_id)
    SELECT v_r, v_s, id FROM unidad_renta WHERE codigo = 'ESC-003';
    INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (v_r, 'deposito', 'efectivo', 50000, v_user);
END $$;
DO $$
DECLARE
    v_user BIGINT := (SELECT id FROM usuario WHERE usuario = 'admin');
    v_r    BIGINT := (SELECT id FROM renta WHERE numero = 'R-00002');
BEGIN
    PERFORM pg_temp.debe_fallar('cancelar con el deposito sin devolver',
        format($f$UPDATE renta SET estado = 'cancelada' WHERE id = %s$f$, v_r), NULL, 'deposito');
    INSERT INTO renta_pago (renta_id, tipo, metodo, monto, usuario_id) VALUES (v_r, 'devolucion_deposito', 'efectivo', 50000, v_user);
    UPDATE renta SET estado = 'cancelada' WHERE id = v_r;
    PERFORM pg_temp.ok('renta cancelada: su pieza quedo disponible y la linea cancelada',
        (SELECT estado FROM unidad_renta WHERE codigo = 'ESC-003') = 'disponible'
        AND (SELECT estado_devolucion FROM renta_detalle WHERE renta_id = v_r) = 'cancelada');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Integridad global
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('v_cuadre_lote vacia: cada saldo cuadra con su kardex', (SELECT count(*) FROM v_cuadre_lote) = 0);
INSERT INTO auditoria (accion, tabla) VALUES ('prueba', 'prueba');
SELECT pg_temp.debe_fallar('borrar auditoria', $q$ DELETE FROM auditoria $q$, NULL, 'historica');
SELECT pg_temp.debe_fallar('editar auditoria', $q$ UPDATE auditoria SET accion = 'otra' $q$, NULL, 'historica');

\echo
\echo '=== TODAS LAS PRUEBAS PASARON ==='
