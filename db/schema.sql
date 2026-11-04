-- ============================================================================
-- INVENTARIO, COMPRAS, VENTAS, NOTAS CREDITO Y RENTAS  |  PostgreSQL 17
-- Un solo archivo, una sola base de datos, ejecutar UNA vez sobre una base vacia.
--
--   createdb inventario
--   psql -v ON_ERROR_STOP=1 -d inventario -f schema.sql
--   psql -v ON_ERROR_STOP=1 -d inventario -f seed.sql          (catalogos base)
--   psql -v ON_ERROR_STOP=1 -d inventario -f seed_demo.sql     (solo desarrollo)
--
-- PRINCIPIOS
--   * Estructura ligera; las reglas que protegen el dinero y el stock viven en la
--     base (triggers), no solo en el backend. Un error del backend no puede
--     descuadrar inventario ni cuentas.
--   * Documentos (compra, venta, nota credito): nacen en 'borrador', se editan
--     libremente y se CONFIRMAN una vez; confirmados quedan congelados. Un error
--     se corrige con otro documento (anulacion de compra, nota credito).
--   * Lo historico no se edita ni se borra: movimiento (kardex), lote, pagos,
--     cargos, notas, auditoria.
--   * El stock vive en LOTES. lote_saldo lo mantiene un trigger desde el kardex
--     y nunca baja de cero. Los lotes solo nacen al RECIBIR una compra.
--   * Importes de cada linea = columnas generadas (sin descuadres de redondeo);
--     la cabecera se calcula sumando lineas (vistas v_*_totales).
--   * Precio, impuesto, tarifa y deposito se copian a la linea al crearla
--     (fotografia): cambiar el catalogo despues no altera lo ya hecho.
--   * El estado de cada pieza de renta lo sincronizan triggers.
--
-- LO QUE SIGUE HACIENDO EL BACKEND
--   * Login y permisos (owner y admin_sucursal), sucursales visibles del
--     usuario, regla de delegacion al crear usuarios (nivel_poder y
--     sucursales iguales o menores a los del creador).
--   * Escribir auditoria (nunca claves ni tokens en 'detalle').
--   * Flujos: confirmar_venta(), reingresar_stock(), devolver_pieza(),
--     cerrar_renta(); y para recibir una compra, UPDATE ... SET estado='recibida'.
--   * Facturacion electronica DIAN: fuera de alcance (se integra con un proveedor).
--
-- ERRORES QUE EL BACKEND DEBE TRADUCIR
--   SQLSTATE INV01  stock insuficiente              -> 409
--   SQLSTATE INV02  anulacion de compra imposible   -> 409
--   Otras RAISE EXCEPTION y violaciones 23xxx       -> 422 con el mensaje
--
-- NO INCLUYE: cuentas por pagar, ordenes de compra, traslados entre sucursales.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. NUCLEO
-- ============================================================================

CREATE TABLE sucursal (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL,
    direccion   VARCHAR(250),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sucursal_nombre_no_vacio CHECK (length(btrim(nombre)) > 0)
);

CREATE TABLE categoria_empleado (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    nivel_poder INTEGER NOT NULL CHECK (nivel_poder >= 0),
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE usuario (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre                VARCHAR(180) NOT NULL,
    usuario               VARCHAR(80) NOT NULL,
    clave_hash            VARCHAR(255) NOT NULL,
    categoria_empleado_id BIGINT NOT NULL REFERENCES categoria_empleado (id),
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usuario_nombre_no_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX usuario_login_uq ON usuario (lower(usuario));

CREATE TABLE sucursal_usuario (
    usuario_id  BIGINT NOT NULL REFERENCES usuario (id),
    sucursal_id BIGINT NOT NULL REFERENCES sucursal (id),
    PRIMARY KEY (usuario_id, sucursal_id)
);
CREATE INDEX sucursal_usuario_sucursal_idx ON sucursal_usuario (sucursal_id);

CREATE TABLE auditoria (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id  BIGINT REFERENCES usuario (id),      -- NULL = evento del sistema
    sucursal_id BIGINT REFERENCES sucursal (id),     -- NULL = evento general
    accion      VARCHAR(80) NOT NULL,
    tabla       VARCHAR(100) NOT NULL,
    registro_id BIGINT,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
    detalle     JSONB
);
CREATE INDEX auditoria_sucursal_fecha_idx ON auditoria (sucursal_id, fecha DESC);
CREATE INDEX auditoria_usuario_fecha_idx ON auditoria (usuario_id, fecha DESC);
CREATE INDEX auditoria_registro_idx ON auditoria (tabla, registro_id);

CREATE TABLE cliente (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre           VARCHAR(180) NOT NULL,
    tipo_documento   VARCHAR(30),
    numero_documento VARCHAR(40),
    telefono         VARCHAR(30),
    correo           VARCHAR(180),
    bloqueado        BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_bloqueo   TEXT,
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cliente_nombre_no_vacio CHECK (length(btrim(nombre)) > 0),
    CONSTRAINT cliente_documento_completo CHECK (
        (tipo_documento IS NULL AND numero_documento IS NULL) OR
        (tipo_documento IS NOT NULL AND numero_documento IS NOT NULL)),
    CONSTRAINT cliente_bloqueo_con_motivo CHECK (
        NOT bloqueado OR length(btrim(coalesce(motivo_bloqueo, ''))) > 0)
);
CREATE UNIQUE INDEX cliente_documento_uq ON cliente (tipo_documento, numero_documento)
    WHERE tipo_documento IS NOT NULL AND numero_documento IS NOT NULL;
CREATE INDEX cliente_nombre_idx ON cliente (lower(nombre));

CREATE TABLE documento_consecutivo (
    sucursal_id   BIGINT NOT NULL REFERENCES sucursal (id),
    tipo          VARCHAR(20) NOT NULL
                  CHECK (tipo IN ('compra', 'venta', 'nota_credito', 'renta')),
    ultimo_numero BIGINT NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
    PRIMARY KEY (sucursal_id, tipo)
);

-- ---------------------------------------------------------------------------
-- Funciones comunes
-- ---------------------------------------------------------------------------

-- Tablas historicas: no se actualizan ni se borran filas.
CREATE FUNCTION bloquear_modificacion_historica() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es historica: % no permitido. Corrija con otro registro.',
        TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER auditoria_solo_insercion BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- Siguiente consecutivo por sucursal y tipo. Bloquea la fila: sin repetidos
-- con ventas simultaneas, y si la transaccion se revierte el numero tambien.
CREATE FUNCTION siguiente_numero_documento(p_sucursal_id BIGINT, p_tipo VARCHAR)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_siguiente BIGINT;
BEGIN
    INSERT INTO documento_consecutivo (sucursal_id, tipo, ultimo_numero)
    VALUES (p_sucursal_id, p_tipo, 1)
    ON CONFLICT (sucursal_id, tipo)
    DO UPDATE SET ultimo_numero = documento_consecutivo.ultimo_numero + 1
    RETURNING ultimo_numero INTO v_siguiente;
    RETURN v_siguiente;
END;
$$;

-- Trigger BEFORE INSERT: asigna el numero (V-00001) si llega vacio.
-- Uso: EXECUTE FUNCTION asignar_numero_documento('venta', 'V')
CREATE FUNCTION asignar_numero_documento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.numero IS NULL THEN
        NEW.numero := TG_ARGV[1] || '-' ||
            lpad(siguiente_numero_documento(NEW.sucursal_id, TG_ARGV[0])::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. CATALOGO
-- ============================================================================

CREATE TABLE categoria_producto (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre           VARCHAR(120) NOT NULL UNIQUE,
    maneja_caducidad BOOLEAN NOT NULL DEFAULT FALSE,   -- solo sugiere el valor al crear un producto
    activo           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE producto (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    categoria_producto_id BIGINT NOT NULL REFERENCES categoria_producto (id),
    codigo                VARCHAR(60) NOT NULL,
    codigo_barras         VARCHAR(80) UNIQUE,
    nombre                VARCHAR(180) NOT NULL,
    medida                VARCHAR(30) NOT NULL DEFAULT 'unidad',
    impuesto_porcentaje   NUMERIC(5, 2) NOT NULL DEFAULT 0
                          CHECK (impuesto_porcentaje BETWEEN 0 AND 100),
    maneja_caducidad      BOOLEAN NOT NULL DEFAULT FALSE,
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT producto_nombre_no_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX producto_codigo_uq ON producto (upper(codigo));
CREATE INDEX producto_categoria_idx ON producto (categoria_producto_id);

CREATE TABLE producto_sucursal (
    producto_id  BIGINT NOT NULL REFERENCES producto (id),
    sucursal_id  BIGINT NOT NULL REFERENCES sucursal (id),
    precio_venta NUMERIC(12, 2) NOT NULL CHECK (precio_venta >= 0),
    stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (producto_id, sucursal_id)
);
CREATE INDEX producto_sucursal_sucursal_idx ON producto_sucursal (sucursal_id);

CREATE TABLE proveedor (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre    VARCHAR(180) NOT NULL,
    nit       VARCHAR(40) UNIQUE,
    telefono  VARCHAR(30),
    correo    VARCHAR(180),
    direccion VARCHAR(250),
    activo    BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT proveedor_nombre_no_vacio CHECK (length(btrim(nombre)) > 0)
);

-- ============================================================================
-- 3. COMPRAS, LOTES Y KARDEX
-- ============================================================================

CREATE TABLE compra (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sucursal_id              BIGINT NOT NULL REFERENCES sucursal (id),
    proveedor_id             BIGINT NOT NULL REFERENCES proveedor (id),
    numero                   VARCHAR(60) NOT NULL,          -- C-00001, lo asigna la base
    numero_factura_proveedor VARCHAR(80),
    recibida_por             BIGINT NOT NULL REFERENCES usuario (id),
    fecha                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado                   VARCHAR(20) NOT NULL DEFAULT 'borrador'
                             CHECK (estado IN ('borrador', 'recibida', 'anulada')),
    UNIQUE (sucursal_id, numero),
    UNIQUE (id, sucursal_id)
);
-- Una factura de proveedor no se registra dos veces (salvo que la compra se anule).
CREATE UNIQUE INDEX compra_factura_proveedor_uq
    ON compra (proveedor_id, numero_factura_proveedor)
    WHERE numero_factura_proveedor IS NOT NULL AND estado <> 'anulada';
CREATE INDEX compra_sucursal_fecha_idx ON compra (sucursal_id, fecha DESC);

CREATE TABLE compra_detalle (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_id           BIGINT NOT NULL,
    sucursal_id         BIGINT NOT NULL,
    producto_id         BIGINT NOT NULL,
    cantidad            NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
    costo_unitario      NUMERIC(12, 2) NOT NULL CHECK (costo_unitario >= 0),
    impuesto_porcentaje NUMERIC(5, 2) NOT NULL        -- se copia del producto si no se envia
                        CHECK (impuesto_porcentaje BETWEEN 0 AND 100),
    fecha_caducidad     DATE,
    subtotal            NUMERIC(12, 2) GENERATED ALWAYS AS
                        (round(cantidad * costo_unitario, 2)) STORED,
    impuesto            NUMERIC(12, 2) GENERATED ALWAYS AS
                        (round(round(cantidad * costo_unitario, 2) * impuesto_porcentaje / 100, 2)) STORED,
    total               NUMERIC(12, 2) GENERATED ALWAYS AS
                        (round(cantidad * costo_unitario, 2)
                         + round(round(cantidad * costo_unitario, 2) * impuesto_porcentaje / 100, 2)) STORED,
    FOREIGN KEY (compra_id, sucursal_id) REFERENCES compra (id, sucursal_id),
    FOREIGN KEY (producto_id, sucursal_id) REFERENCES producto_sucursal (producto_id, sucursal_id),
    UNIQUE (id, sucursal_id, producto_id)
);
CREATE INDEX compra_detalle_compra_idx ON compra_detalle (compra_id);

-- Lote: lo que llego en una linea de compra. Inmutable; solo nace al recibir la compra.
CREATE TABLE lote (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_detalle_id BIGINT NOT NULL UNIQUE,
    sucursal_id       BIGINT NOT NULL,
    producto_id       BIGINT NOT NULL,
    costo_unitario    NUMERIC(12, 2) NOT NULL CHECK (costo_unitario >= 0),
    cantidad_inicial  NUMERIC(12, 3) NOT NULL CHECK (cantidad_inicial > 0),
    fecha_compra      TIMESTAMPTZ NOT NULL,
    fecha_caducidad   DATE,
    UNIQUE (id, sucursal_id, producto_id),
    FOREIGN KEY (compra_detalle_id, sucursal_id, producto_id)
        REFERENCES compra_detalle (id, sucursal_id, producto_id)
);
-- Orden FEFO / FIFO.
CREATE INDEX lote_fefo_idx ON lote (producto_id, sucursal_id, fecha_caducidad NULLS LAST, fecha_compra, id);
CREATE INDEX lote_caducidad_idx ON lote (fecha_caducidad) WHERE fecha_caducidad IS NOT NULL;

CREATE TABLE lote_saldo (
    lote_id         BIGINT PRIMARY KEY REFERENCES lote (id),
    cantidad_actual NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0)
);

-- Kardex: cantidad con signo (positiva entra, negativa sale). Solo insercion.
CREATE TABLE movimiento (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_id            BIGINT NOT NULL,
    sucursal_id        BIGINT NOT NULL,
    producto_id        BIGINT NOT NULL,
    tipo               VARCHAR(20) NOT NULL
                       CHECK (tipo IN ('compra', 'anulacion_compra', 'venta',
                                       'devolucion', 'ajuste', 'baja')),
    cantidad_con_signo NUMERIC(12, 3) NOT NULL CHECK (cantidad_con_signo <> 0),
    motivo             TEXT,
    usuario_id         BIGINT NOT NULL REFERENCES usuario (id),
    fecha              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, sucursal_id),
    UNIQUE (id, sucursal_id, producto_id),
    FOREIGN KEY (lote_id, sucursal_id, producto_id)
        REFERENCES lote (id, sucursal_id, producto_id),
    CHECK ((tipo IN ('compra', 'devolucion') AND cantidad_con_signo > 0)
        OR (tipo IN ('anulacion_compra', 'venta', 'baja') AND cantidad_con_signo < 0)
        OR tipo = 'ajuste'),
    CHECK (tipo NOT IN ('ajuste', 'baja') OR length(btrim(coalesce(motivo, ''))) > 0)
);
CREATE INDEX movimiento_lote_idx ON movimiento (lote_id, fecha);
CREATE INDEX movimiento_sucursal_fecha_idx ON movimiento (sucursal_id, fecha DESC);

CREATE TABLE compra_anulacion (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_id  BIGINT NOT NULL UNIQUE REFERENCES compra (id),
    usuario_id BIGINT NOT NULL REFERENCES usuario (id),
    motivo     TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
    fecha      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Triggers de compras e inventario
-- ---------------------------------------------------------------------------

CREATE FUNCTION preparar_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Una compra siempre nace en borrador';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER compra_numero BEFORE INSERT ON compra
    FOR EACH ROW EXECUTE FUNCTION asignar_numero_documento('compra', 'C');
CREATE TRIGGER compra_preparar BEFORE INSERT ON compra
    FOR EACH ROW EXECUTE FUNCTION preparar_compra();

-- Borrador -> recibida (crea lotes) | recibida -> anulada (solo via compra_anulacion).
CREATE FUNCTION controlar_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado <> 'borrador' THEN
            RAISE EXCEPTION 'Solo se borra una compra en borrador (esta %)', OLD.estado;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.estado = 'anulada' THEN
        RAISE EXCEPTION 'La compra % esta anulada y no se modifica', OLD.numero;
    ELSIF OLD.estado = 'recibida' THEN
        IF NEW.estado <> 'anulada' OR pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'La compra % ya fue recibida: se corrige anulandola (compra_anulacion)', OLD.numero;
        END IF;
        IF (to_jsonb(OLD) - 'estado') <> (to_jsonb(NEW) - 'estado') THEN
            RAISE EXCEPTION 'Al anular una compra solo cambia su estado';
        END IF;
    ELSE
        IF NEW.estado = 'anulada' THEN
            RAISE EXCEPTION 'Una compra en borrador no se anula: se borra';
        END IF;
        IF NEW.estado = 'recibida'
           AND NOT EXISTS (SELECT 1 FROM compra_detalle WHERE compra_id = OLD.id) THEN
            RAISE EXCEPTION 'La compra % no tiene lineas', OLD.numero;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER compra_controlar BEFORE UPDATE OR DELETE ON compra
    FOR EACH ROW EXECUTE FUNCTION controlar_compra();

-- Linea de compra: solo en borrador; copia el IVA del producto; exige caducidad.
CREATE FUNCTION preparar_compra_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    v_prod   RECORD;
BEGIN
    SELECT estado INTO v_estado FROM compra WHERE id = NEW.compra_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Solo se agregan lineas a una compra en borrador';
    END IF;

    SELECT nombre, activo, impuesto_porcentaje, maneja_caducidad INTO v_prod
      FROM producto WHERE id = NEW.producto_id;
    IF NOT FOUND OR NOT v_prod.activo THEN
        RAISE EXCEPTION 'El producto % no existe o esta inactivo', NEW.producto_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM producto_sucursal
                    WHERE producto_id = NEW.producto_id
                      AND sucursal_id = NEW.sucursal_id AND activo) THEN
        RAISE EXCEPTION 'El producto "%" no esta habilitado en esta sucursal', v_prod.nombre;
    END IF;

    IF NEW.impuesto_porcentaje IS NULL THEN
        NEW.impuesto_porcentaje := v_prod.impuesto_porcentaje;
    END IF;
    IF v_prod.maneja_caducidad AND NEW.fecha_caducidad IS NULL THEN
        RAISE EXCEPTION 'El producto "%" exige fecha de caducidad en cada lote', v_prod.nombre;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER compra_detalle_preparar BEFORE INSERT ON compra_detalle
    FOR EACH ROW EXECUTE FUNCTION preparar_compra_detalle();

-- Cambiar o borrar lineas: solo mientras la compra es borrador.
CREATE FUNCTION controlar_compra_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT estado INTO v_estado FROM compra WHERE id = OLD.compra_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Las lineas de una compra % no se modifican', v_estado;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.compra_id <> OLD.compra_id THEN
        RAISE EXCEPTION 'Una linea no cambia de compra';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER compra_detalle_controlar BEFORE UPDATE OR DELETE ON compra_detalle
    FOR EACH ROW EXECUTE FUNCTION controlar_compra_detalle();

-- Recibir la compra: cada linea crea su lote (con la fecha de la compra).
CREATE FUNCTION recibir_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    d RECORD;
BEGIN
    IF OLD.estado = 'borrador' AND NEW.estado = 'recibida' THEN
        FOR d IN SELECT * FROM compra_detalle WHERE compra_id = NEW.id ORDER BY id LOOP
            INSERT INTO lote (compra_detalle_id, sucursal_id, producto_id, costo_unitario,
                              cantidad_inicial, fecha_compra, fecha_caducidad)
            VALUES (d.id, d.sucursal_id, d.producto_id, d.costo_unitario,
                    d.cantidad, NEW.fecha, d.fecha_caducidad);
        END LOOP;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER compra_recibir AFTER UPDATE ON compra
    FOR EACH ROW EXECUTE FUNCTION recibir_compra();

-- Los lotes solo nacen desde recibir_compra (el trigger corre a profundidad 2).
CREATE FUNCTION exigir_lote_desde_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Los lotes no se crean a mano: se crean al recibir una compra';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER lote_solo_desde_compra BEFORE INSERT ON lote
    FOR EACH ROW EXECUTE FUNCTION exigir_lote_desde_compra();
CREATE TRIGGER lote_solo_insercion BEFORE UPDATE OR DELETE ON lote
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- Cada lote nace con saldo 0 y su movimiento 'compra' lo sube a la cantidad inicial.
CREATE FUNCTION iniciar_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_usuario BIGINT;
BEGIN
    INSERT INTO lote_saldo (lote_id, cantidad_actual) VALUES (NEW.id, 0);
    SELECT c.recibida_por INTO v_usuario
      FROM compra_detalle d JOIN compra c ON c.id = d.compra_id
     WHERE d.id = NEW.compra_detalle_id;
    INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
    VALUES (NEW.id, NEW.sucursal_id, NEW.producto_id, 'compra', NEW.cantidad_inicial, v_usuario);
    RETURN NULL;
END;
$$;
CREATE TRIGGER lote_iniciar AFTER INSERT ON lote
    FOR EACH ROW EXECUTE FUNCTION iniciar_lote();

-- El saldo solo lo mueve el kardex (el trigger de movimiento corre a profundidad >= 2).
CREATE FUNCTION proteger_lote_saldo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'lote_saldo no se modifica a mano: lo actualiza el kardex (movimiento)';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER lote_saldo_proteger BEFORE UPDATE OR DELETE ON lote_saldo
    FOR EACH ROW EXECUTE FUNCTION proteger_lote_saldo();

-- Compra y anulacion de compra solo se registran desde sus propios flujos.
CREATE FUNCTION validar_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tipo IN ('compra', 'anulacion_compra') AND pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Los movimientos de tipo % los genera la compra, no se insertan a mano', NEW.tipo;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER movimiento_validar BEFORE INSERT ON movimiento
    FOR EACH ROW EXECUTE FUNCTION validar_movimiento();
CREATE TRIGGER movimiento_solo_insercion BEFORE UPDATE OR DELETE ON movimiento
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

CREATE FUNCTION aplicar_movimiento_saldo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE lote_saldo
       SET cantidad_actual = cantidad_actual + NEW.cantidad_con_signo
     WHERE lote_id = NEW.lote_id
       AND cantidad_actual + NEW.cantidad_con_signo >= 0;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente en el lote % (movimiento %)', NEW.lote_id, NEW.tipo
            USING ERRCODE = 'INV01';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER movimiento_actualizar_saldo AFTER INSERT ON movimiento
    FOR EACH ROW EXECUTE FUNCTION aplicar_movimiento_saldo();

-- Anular una compra: un movimiento contrario por lote; si parte del stock ya
-- salio, falla (INV02). Marca la compra como anulada.
CREATE FUNCTION anular_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    r        RECORD;
BEGIN
    SELECT estado INTO v_estado FROM compra WHERE id = NEW.compra_id FOR UPDATE;
    IF v_estado IS DISTINCT FROM 'recibida' THEN
        RAISE EXCEPTION 'Solo se anula una compra recibida (esta %)', v_estado;
    END IF;
    FOR r IN SELECT lt.id, lt.sucursal_id, lt.producto_id, lt.cantidad_inicial
               FROM lote lt JOIN compra_detalle d ON d.id = lt.compra_detalle_id
              WHERE d.compra_id = NEW.compra_id ORDER BY lt.id
    LOOP
        BEGIN
            INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo,
                                    cantidad_con_signo, motivo, usuario_id)
            VALUES (r.id, r.sucursal_id, r.producto_id, 'anulacion_compra',
                    -r.cantidad_inicial, NEW.motivo, NEW.usuario_id);
        EXCEPTION WHEN SQLSTATE 'INV01' THEN
            RAISE EXCEPTION 'No se puede anular la compra: parte del stock del lote % ya salio', r.id
                USING ERRCODE = 'INV02';
        END;
    END LOOP;
    UPDATE compra SET estado = 'anulada' WHERE id = NEW.compra_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER compra_anulacion_ejecutar AFTER INSERT ON compra_anulacion
    FOR EACH ROW EXECUTE FUNCTION anular_compra();
CREATE TRIGGER compra_anulacion_solo_insercion BEFORE UPDATE OR DELETE ON compra_anulacion
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- ============================================================================
-- 4. VENTAS, NOTAS CREDITO Y PAGOS
-- ============================================================================

CREATE TABLE venta (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sucursal_id BIGINT NOT NULL REFERENCES sucursal (id),
    cliente_id  BIGINT REFERENCES cliente (id),         -- NULL = consumidor final
    vendedor_id BIGINT NOT NULL REFERENCES usuario (id),
    numero      VARCHAR(60) NOT NULL,                   -- V-00001
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado      VARCHAR(20) NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador', 'confirmada')),
    UNIQUE (sucursal_id, numero),
    UNIQUE (id, sucursal_id)
);
CREATE INDEX venta_sucursal_fecha_idx ON venta (sucursal_id, fecha DESC);
CREATE INDEX venta_cliente_idx ON venta (cliente_id) WHERE cliente_id IS NOT NULL;

CREATE TABLE venta_detalle (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id             BIGINT NOT NULL,
    sucursal_id          BIGINT NOT NULL,
    producto_id          BIGINT NOT NULL,
    cantidad             NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
    precio_unitario      NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
    descuento_porcentaje NUMERIC(5, 2) NOT NULL DEFAULT 0
                         CHECK (descuento_porcentaje BETWEEN 0 AND 100),
    impuesto_porcentaje  NUMERIC(5, 2) NOT NULL
                         CHECK (impuesto_porcentaje BETWEEN 0 AND 100),
    -- subtotal = bruto; el impuesto va sobre (subtotal - descuento).
    subtotal  NUMERIC(12, 2) GENERATED ALWAYS AS
              (round(cantidad * precio_unitario, 2)) STORED,
    descuento NUMERIC(12, 2) GENERATED ALWAYS AS
              (round(round(cantidad * precio_unitario, 2) * descuento_porcentaje / 100, 2)) STORED,
    impuesto  NUMERIC(12, 2) GENERATED ALWAYS AS
              (round((round(cantidad * precio_unitario, 2)
                      - round(round(cantidad * precio_unitario, 2) * descuento_porcentaje / 100, 2))
                     * impuesto_porcentaje / 100, 2)) STORED,
    total     NUMERIC(12, 2) GENERATED ALWAYS AS
              (round(cantidad * precio_unitario, 2)
               - round(round(cantidad * precio_unitario, 2) * descuento_porcentaje / 100, 2)
               + round((round(cantidad * precio_unitario, 2)
                        - round(round(cantidad * precio_unitario, 2) * descuento_porcentaje / 100, 2))
                       * impuesto_porcentaje / 100, 2)) STORED,
    FOREIGN KEY (venta_id, sucursal_id) REFERENCES venta (id, sucursal_id),
    FOREIGN KEY (producto_id, sucursal_id) REFERENCES producto_sucursal (producto_id, sucursal_id),
    UNIQUE (id, sucursal_id),
    UNIQUE (id, sucursal_id, producto_id),
    UNIQUE (id, venta_id, sucursal_id)
);
CREATE INDEX venta_detalle_venta_idx ON venta_detalle (venta_id);
CREATE INDEX venta_detalle_producto_idx ON venta_detalle (producto_id, sucursal_id);

-- De que lotes salio cada linea. Cada fila liga la linea con un movimiento de venta.
CREATE TABLE venta_lote (
    venta_detalle_id BIGINT NOT NULL,
    movimiento_id    BIGINT NOT NULL UNIQUE,
    sucursal_id      BIGINT NOT NULL,
    producto_id      BIGINT NOT NULL,
    PRIMARY KEY (venta_detalle_id, movimiento_id),
    FOREIGN KEY (venta_detalle_id, sucursal_id, producto_id)
        REFERENCES venta_detalle (id, sucursal_id, producto_id),
    FOREIGN KEY (movimiento_id, sucursal_id, producto_id)
        REFERENCES movimiento (id, sucursal_id, producto_id)
);

CREATE TABLE nota_credito (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id    BIGINT NOT NULL,
    sucursal_id BIGINT NOT NULL,
    numero      VARCHAR(60) NOT NULL,                   -- NC-00001
    emitida_por BIGINT NOT NULL REFERENCES usuario (id),
    motivo      TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado      VARCHAR(20) NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador', 'confirmada')),
    FOREIGN KEY (venta_id, sucursal_id) REFERENCES venta (id, sucursal_id),
    UNIQUE (sucursal_id, numero),
    UNIQUE (id, sucursal_id),
    UNIQUE (id, venta_id, sucursal_id)
);
CREATE INDEX nota_credito_venta_idx ON nota_credito (venta_id);

-- Lineas acreditadas. Los importes los calcula la base en proporcion a la linea
-- vendida (la ultima parte toma el resto exacto, sin centavos sueltos).
CREATE TABLE nota_credito_detalle (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nota_credito_id  BIGINT NOT NULL,
    venta_id         BIGINT NOT NULL,
    sucursal_id      BIGINT NOT NULL,
    venta_detalle_id BIGINT NOT NULL,
    cantidad         NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
    subtotal         NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
    descuento        NUMERIC(12, 2) NOT NULL CHECK (descuento >= 0),
    impuesto         NUMERIC(12, 2) NOT NULL CHECK (impuesto >= 0),
    total            NUMERIC(12, 2) NOT NULL,
    FOREIGN KEY (nota_credito_id, venta_id, sucursal_id)
        REFERENCES nota_credito (id, venta_id, sucursal_id),
    FOREIGN KEY (venta_detalle_id, venta_id, sucursal_id)
        REFERENCES venta_detalle (id, venta_id, sucursal_id),
    UNIQUE (id, sucursal_id),
    CHECK (descuento <= subtotal),
    CHECK (total = subtotal - descuento + impuesto)
);
CREATE INDEX nota_credito_detalle_nc_idx ON nota_credito_detalle (nota_credito_id);
CREATE INDEX nota_credito_detalle_linea_idx ON nota_credito_detalle (venta_detalle_id);

-- Regreso fisico al stock, tras inspeccionar lo devuelto (opcional por linea).
CREATE TABLE nota_credito_reingreso (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nota_credito_detalle_id BIGINT NOT NULL,
    sucursal_id             BIGINT NOT NULL,
    movimiento_id           BIGINT NOT NULL UNIQUE,
    cantidad                NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
    FOREIGN KEY (nota_credito_detalle_id, sucursal_id)
        REFERENCES nota_credito_detalle (id, sucursal_id),
    FOREIGN KEY (movimiento_id, sucursal_id) REFERENCES movimiento (id, sucursal_id)
);
CREATE INDEX nota_credito_reingreso_detalle_idx ON nota_credito_reingreso (nota_credito_detalle_id);

CREATE TABLE venta_pago (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id        BIGINT NOT NULL REFERENCES venta (id),
    nota_credito_id BIGINT REFERENCES nota_credito (id),   -- solo en reembolsos
    tipo            VARCHAR(20) NOT NULL DEFAULT 'pago' CHECK (tipo IN ('pago', 'reembolso')),
    metodo          VARCHAR(20) NOT NULL
                    CHECK (metodo IN ('efectivo', 'transferencia', 'tarjeta', 'otro')),
    monto           NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
    referencia      VARCHAR(120),
    usuario_id      BIGINT NOT NULL REFERENCES usuario (id),
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((tipo = 'pago' AND nota_credito_id IS NULL)
        OR (tipo = 'reembolso' AND nota_credito_id IS NOT NULL))
);
CREATE INDEX venta_pago_venta_idx ON venta_pago (venta_id, fecha DESC);

-- ---------------------------------------------------------------------------
-- Triggers de ventas
-- ---------------------------------------------------------------------------

CREATE FUNCTION preparar_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Una venta siempre nace en borrador';
    END IF;
    IF NEW.cliente_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM cliente WHERE id = NEW.cliente_id AND activo) THEN
        RAISE EXCEPTION 'El cliente % no existe o esta inactivo', NEW.cliente_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER venta_numero BEFORE INSERT ON venta
    FOR EACH ROW EXECUTE FUNCTION asignar_numero_documento('venta', 'V');
CREATE TRIGGER venta_preparar BEFORE INSERT ON venta
    FOR EACH ROW EXECUTE FUNCTION preparar_venta();

-- Borrador -> confirmada solo si tiene lineas y TODA su cantidad tiene lote asignado.
-- Una venta confirmada no se vuelve a tocar: se corrige con nota credito.
CREATE FUNCTION controlar_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    l RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado <> 'borrador' THEN
            RAISE EXCEPTION 'Una venta confirmada no se borra: use una nota credito';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.estado = 'confirmada' THEN
        RAISE EXCEPTION 'La venta % esta confirmada y no se modifica: use una nota credito', OLD.numero;
    END IF;
    IF NEW.estado = 'confirmada' THEN
        IF NOT EXISTS (SELECT 1 FROM venta_detalle WHERE venta_id = OLD.id) THEN
            RAISE EXCEPTION 'La venta % no tiene lineas', OLD.numero;
        END IF;
        FOR l IN
            SELECT d.id, d.cantidad, COALESCE(SUM(abs(m.cantidad_con_signo)), 0) AS asignada
              FROM venta_detalle d
              LEFT JOIN venta_lote vl ON vl.venta_detalle_id = d.id
              LEFT JOIN movimiento m ON m.id = vl.movimiento_id
             WHERE d.venta_id = OLD.id
             GROUP BY d.id, d.cantidad
            HAVING COALESCE(SUM(abs(m.cantidad_con_signo)), 0) <> d.cantidad
        LOOP
            RAISE EXCEPTION 'La linea % de la venta % tiene % de % unidades con lote asignado',
                l.id, OLD.numero, l.asignada, l.cantidad;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER venta_controlar BEFORE UPDATE OR DELETE ON venta
    FOR EACH ROW EXECUTE FUNCTION controlar_venta();

-- Linea de venta: solo en borrador; copia precio e IVA del catalogo.
CREATE FUNCTION preparar_venta_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    v_prod   RECORD;
    v_ps     RECORD;
BEGIN
    SELECT estado INTO v_estado FROM venta WHERE id = NEW.venta_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Solo se agregan lineas a una venta en borrador';
    END IF;
    SELECT nombre, activo, impuesto_porcentaje INTO v_prod FROM producto WHERE id = NEW.producto_id;
    IF NOT FOUND OR NOT v_prod.activo THEN
        RAISE EXCEPTION 'El producto % no existe o esta inactivo', NEW.producto_id;
    END IF;
    SELECT precio_venta, activo INTO v_ps FROM producto_sucursal
     WHERE producto_id = NEW.producto_id AND sucursal_id = NEW.sucursal_id;
    IF NOT FOUND OR NOT v_ps.activo THEN
        RAISE EXCEPTION 'El producto "%" no esta habilitado en esta sucursal', v_prod.nombre;
    END IF;
    IF NEW.precio_unitario IS NULL THEN NEW.precio_unitario := v_ps.precio_venta; END IF;
    IF NEW.impuesto_porcentaje IS NULL THEN NEW.impuesto_porcentaje := v_prod.impuesto_porcentaje; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER venta_detalle_preparar BEFORE INSERT ON venta_detalle
    FOR EACH ROW EXECUTE FUNCTION preparar_venta_detalle();

CREATE FUNCTION controlar_venta_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT estado INTO v_estado FROM venta WHERE id = OLD.venta_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Las lineas de una venta % no se modifican', v_estado;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.venta_id <> OLD.venta_id THEN
        RAISE EXCEPTION 'Una linea no cambia de venta';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER venta_detalle_controlar BEFORE UPDATE OR DELETE ON venta_detalle
    FOR EACH ROW EXECUTE FUNCTION controlar_venta_detalle();

-- Asignacion de lote: movimiento de salida 'venta', venta en borrador, sin pasarse.
CREATE FUNCTION validar_venta_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_tipo      TEXT;
    v_mov       NUMERIC;
    v_linea     NUMERIC;
    v_estado    TEXT;
    v_asignada  NUMERIC;
BEGIN
    SELECT tipo, cantidad_con_signo INTO v_tipo, v_mov FROM movimiento WHERE id = NEW.movimiento_id;
    IF v_tipo IS DISTINCT FROM 'venta' THEN
        RAISE EXCEPTION 'venta_lote debe apuntar a un movimiento de salida por venta';
    END IF;

    SELECT d.cantidad, v.estado INTO v_linea, v_estado
      FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
     WHERE d.id = NEW.venta_detalle_id FOR UPDATE OF d;
    IF v_estado <> 'borrador' THEN
        RAISE EXCEPTION 'Los lotes solo se asignan mientras la venta es borrador';
    END IF;

    SELECT COALESCE(SUM(abs(m.cantidad_con_signo)), 0) INTO v_asignada
      FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id
     WHERE vl.venta_detalle_id = NEW.venta_detalle_id;
    IF v_asignada + abs(v_mov) > v_linea THEN
        RAISE EXCEPTION 'La asignacion de lotes supera la cantidad de la linea de venta';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER venta_lote_validar BEFORE INSERT ON venta_lote
    FOR EACH ROW EXECUTE FUNCTION validar_venta_lote();
CREATE TRIGGER venta_lote_solo_insercion BEFORE UPDATE OR DELETE ON venta_lote
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- Al confirmar (COMMIT) todo movimiento de venta o devolucion debe tener su documento.
CREATE FUNCTION verificar_origen_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tipo = 'venta' AND NOT EXISTS
        (SELECT 1 FROM venta_lote WHERE movimiento_id = NEW.id) THEN
        RAISE EXCEPTION 'El movimiento % (venta) no esta asignado a ninguna linea de venta', NEW.id;
    END IF;
    IF NEW.tipo = 'devolucion' AND NOT EXISTS
        (SELECT 1 FROM nota_credito_reingreso WHERE movimiento_id = NEW.id) THEN
        RAISE EXCEPTION 'El movimiento % (devolucion) no tiene reingreso de nota credito', NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER movimiento_origen AFTER INSERT ON movimiento
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verificar_origen_movimiento();

-- ---------------------------------------------------------------------------
-- Notas credito
-- ---------------------------------------------------------------------------

CREATE FUNCTION preparar_nota_credito() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Una nota credito siempre nace en borrador';
    END IF;
    IF (SELECT estado FROM venta WHERE id = NEW.venta_id) <> 'confirmada' THEN
        RAISE EXCEPTION 'Solo se emiten notas credito sobre ventas confirmadas';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER nota_credito_numero BEFORE INSERT ON nota_credito
    FOR EACH ROW EXECUTE FUNCTION asignar_numero_documento('nota_credito', 'NC');
CREATE TRIGGER nota_credito_preparar BEFORE INSERT ON nota_credito
    FOR EACH ROW EXECUTE FUNCTION preparar_nota_credito();

CREATE FUNCTION controlar_nota_credito() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado <> 'borrador' THEN
            RAISE EXCEPTION 'Una nota credito confirmada no se borra';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.estado = 'confirmada' THEN
        RAISE EXCEPTION 'La nota credito % esta confirmada y no se modifica', OLD.numero;
    END IF;
    IF NEW.estado = 'confirmada'
       AND NOT EXISTS (SELECT 1 FROM nota_credito_detalle WHERE nota_credito_id = OLD.id) THEN
        RAISE EXCEPTION 'La nota credito % no tiene lineas', OLD.numero;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER nota_credito_controlar BEFORE UPDATE OR DELETE ON nota_credito
    FOR EACH ROW EXECUTE FUNCTION controlar_nota_credito();

-- Linea de nota credito: nunca se acredita mas de lo vendido (cantidad ni dinero).
-- FOR UPDATE: dos notas sobre la misma linea se hacen turno.
CREATE FUNCTION preparar_nota_credito_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    vd       RECORD;
    prev     RECORD;
BEGIN
    SELECT estado INTO v_estado FROM nota_credito WHERE id = NEW.nota_credito_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'Solo se agregan lineas a una nota credito en borrador';
    END IF;

    SELECT cantidad, subtotal, descuento, impuesto INTO vd
      FROM venta_detalle WHERE id = NEW.venta_detalle_id FOR UPDATE;
    SELECT COALESCE(SUM(cantidad), 0) AS c, COALESCE(SUM(subtotal), 0) AS s,
           COALESCE(SUM(descuento), 0) AS d, COALESCE(SUM(impuesto), 0) AS i
      INTO prev FROM nota_credito_detalle WHERE venta_detalle_id = NEW.venta_detalle_id;

    IF prev.c + NEW.cantidad > vd.cantidad THEN
        RAISE EXCEPTION 'Se acreditaria mas de lo vendido (vendido %, ya acreditado %, nuevo %)',
            vd.cantidad, prev.c, NEW.cantidad;
    END IF;

    IF prev.c + NEW.cantidad = vd.cantidad THEN        -- ultima parte: toma el resto exacto
        NEW.subtotal  := vd.subtotal  - prev.s;
        NEW.descuento := vd.descuento - prev.d;
        NEW.impuesto  := vd.impuesto  - prev.i;
    ELSE
        NEW.subtotal  := round(vd.subtotal  * NEW.cantidad / vd.cantidad, 2);
        NEW.descuento := round(vd.descuento * NEW.cantidad / vd.cantidad, 2);
        NEW.impuesto  := round(vd.impuesto  * NEW.cantidad / vd.cantidad, 2);
    END IF;
    NEW.total := NEW.subtotal - NEW.descuento + NEW.impuesto;
    RETURN NEW;
END;
$$;
CREATE TRIGGER nota_credito_detalle_preparar BEFORE INSERT ON nota_credito_detalle
    FOR EACH ROW EXECUTE FUNCTION preparar_nota_credito_detalle();

CREATE FUNCTION controlar_nota_credito_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Las lineas de una nota credito no se editan: borre y cree de nuevo (en borrador)';
    END IF;
    IF (SELECT estado FROM nota_credito WHERE id = OLD.nota_credito_id) <> 'borrador' THEN
        RAISE EXCEPTION 'Las lineas de una nota credito confirmada no se borran';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER nota_credito_detalle_controlar BEFORE UPDATE OR DELETE ON nota_credito_detalle
    FOR EACH ROW EXECUTE FUNCTION controlar_nota_credito_detalle();

-- Reingreso: nota confirmada, movimiento 'devolucion' por esa cantidad, sin pasarse
-- de lo acreditado ni de lo que salio de ESE lote en esa linea.
CREATE FUNCTION validar_reingreso() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    m        RECORD;
    v_ncd    RECORD;
    v_ya_nc  NUMERIC;
    v_salio  NUMERIC;
    v_ya_lot NUMERIC;
BEGIN
    SELECT tipo, cantidad_con_signo, lote_id INTO m FROM movimiento WHERE id = NEW.movimiento_id;
    IF m.tipo IS DISTINCT FROM 'devolucion' OR m.cantidad_con_signo <> NEW.cantidad THEN
        RAISE EXCEPTION 'El movimiento % debe ser una devolucion por % unidades', NEW.movimiento_id, NEW.cantidad;
    END IF;

    SELECT d.id, d.cantidad, d.venta_detalle_id, n.estado INTO v_ncd
      FROM nota_credito_detalle d JOIN nota_credito n ON n.id = d.nota_credito_id
     WHERE d.id = NEW.nota_credito_detalle_id FOR UPDATE OF d;
    IF v_ncd.estado <> 'confirmada' THEN
        RAISE EXCEPTION 'Solo se reingresa stock de una nota credito confirmada';
    END IF;

    SELECT COALESCE(SUM(cantidad), 0) INTO v_ya_nc FROM nota_credito_reingreso
     WHERE nota_credito_detalle_id = NEW.nota_credito_detalle_id;
    IF v_ya_nc + NEW.cantidad > v_ncd.cantidad THEN
        RAISE EXCEPTION 'Se reingresaria mas de lo acreditado (acreditado %, ya reingresado %, nuevo %)',
            v_ncd.cantidad, v_ya_nc, NEW.cantidad;
    END IF;

    SELECT COALESCE(SUM(abs(x.cantidad_con_signo)), 0) INTO v_salio
      FROM venta_lote vl JOIN movimiento x ON x.id = vl.movimiento_id
     WHERE vl.venta_detalle_id = v_ncd.venta_detalle_id AND x.lote_id = m.lote_id;
    SELECT COALESCE(SUM(r.cantidad), 0) INTO v_ya_lot
      FROM nota_credito_reingreso r
      JOIN movimiento x ON x.id = r.movimiento_id
      JOIN nota_credito_detalle d ON d.id = r.nota_credito_detalle_id
     WHERE d.venta_detalle_id = v_ncd.venta_detalle_id AND x.lote_id = m.lote_id;
    IF v_ya_lot + NEW.cantidad > v_salio THEN
        RAISE EXCEPTION 'Se reingresaria mas de lo que salio de ese lote (salio %, ya reingresado %, nuevo %)',
            v_salio, v_ya_lot, NEW.cantidad;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER nota_credito_reingreso_validar BEFORE INSERT ON nota_credito_reingreso
    FOR EACH ROW EXECUTE FUNCTION validar_reingreso();
CREATE TRIGGER nota_credito_reingreso_solo_insercion BEFORE UPDATE OR DELETE ON nota_credito_reingreso
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- Pagos de venta: venta confirmada; no se cobra mas de la deuda neta (total menos
-- notas credito confirmadas); un reembolso nace de una nota confirmada de esa venta.
CREATE FUNCTION validar_venta_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado   TEXT;
    v_total    NUMERIC;
    v_nc_total NUMERIC;
    v_deuda    NUMERIC;
    v_neto     NUMERIC;
    v_nc       RECORD;
    v_reemb    NUMERIC;
BEGIN
    SELECT estado INTO v_estado FROM venta WHERE id = NEW.venta_id FOR UPDATE;
    IF v_estado IS DISTINCT FROM 'confirmada' THEN
        RAISE EXCEPTION 'Solo se registran pagos de una venta confirmada';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_total FROM venta_detalle WHERE venta_id = NEW.venta_id;
    SELECT COALESCE(SUM(d.total), 0) INTO v_nc_total
      FROM nota_credito_detalle d JOIN nota_credito n ON n.id = d.nota_credito_id
     WHERE n.venta_id = NEW.venta_id AND n.estado = 'confirmada';
    SELECT COALESCE(SUM(CASE tipo WHEN 'pago' THEN monto ELSE -monto END), 0)
      INTO v_neto FROM venta_pago WHERE venta_id = NEW.venta_id;
    v_deuda := v_total - v_nc_total;

    IF NEW.tipo = 'pago' THEN
        IF v_neto + NEW.monto > v_deuda THEN
            RAISE EXCEPTION 'El pago excede lo que se debe (deuda %, ya pagado %)', v_deuda, v_neto;
        END IF;
    ELSE
        SELECT n.venta_id, n.estado, COALESCE(SUM(d.total), 0) AS total INTO v_nc
          FROM nota_credito n LEFT JOIN nota_credito_detalle d ON d.nota_credito_id = n.id
         WHERE n.id = NEW.nota_credito_id GROUP BY n.venta_id, n.estado;
        IF v_nc.venta_id IS DISTINCT FROM NEW.venta_id OR v_nc.estado <> 'confirmada' THEN
            RAISE EXCEPTION 'El reembolso exige una nota credito confirmada de esta venta';
        END IF;
        SELECT COALESCE(SUM(monto), 0) INTO v_reemb FROM venta_pago
         WHERE nota_credito_id = NEW.nota_credito_id AND tipo = 'reembolso';
        IF v_reemb + NEW.monto > v_nc.total THEN
            RAISE EXCEPTION 'El reembolso excede la nota credito (nota %, ya reembolsado %)', v_nc.total, v_reemb;
        END IF;
        IF v_neto - NEW.monto < v_deuda THEN
            RAISE EXCEPTION 'No hay dinero pagado de mas por reembolsar (deuda %, pagado %)', v_deuda, v_neto;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER venta_pago_validar BEFORE INSERT ON venta_pago
    FOR EACH ROW EXECUTE FUNCTION validar_venta_pago();
CREATE TRIGGER venta_pago_solo_insercion BEFORE UPDATE OR DELETE ON venta_pago
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- ---------------------------------------------------------------------------
-- Funciones para el backend
-- ---------------------------------------------------------------------------

-- Asigna a una linea los lotes por FEFO (vence antes) y FIFO (mas antiguo si no
-- caduca), saltando vencidos. Bloquea los saldos (FOR UPDATE): ventas simultaneas
-- del mismo producto se hacen turno. Sin stock suficiente: INV01 y todo se revierte.
CREATE FUNCTION asignar_fefo(p_venta_detalle_id BIGINT, p_usuario_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
    v_det   RECORD;
    v_pend  NUMERIC;
    v_lote  RECORD;
    v_tomar NUMERIC;
    v_mov   BIGINT;
    v_total NUMERIC := 0;
BEGIN
    SELECT id, producto_id, sucursal_id, cantidad INTO v_det
      FROM venta_detalle WHERE id = p_venta_detalle_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la linea de venta %', p_venta_detalle_id;
    END IF;
    SELECT v_det.cantidad - COALESCE(SUM(abs(m.cantidad_con_signo)), 0) INTO v_pend
      FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id
     WHERE vl.venta_detalle_id = p_venta_detalle_id;
    IF v_pend <= 0 THEN
        RETURN 0;
    END IF;

    FOR v_lote IN
        SELECT l.id AS lote_id, s.cantidad_actual AS saldo
          FROM lote l JOIN lote_saldo s ON s.lote_id = l.id
         WHERE l.producto_id = v_det.producto_id AND l.sucursal_id = v_det.sucursal_id
           AND s.cantidad_actual > 0
           AND (l.fecha_caducidad IS NULL OR l.fecha_caducidad >= CURRENT_DATE)
         ORDER BY l.fecha_caducidad NULLS LAST, l.fecha_compra, l.id
           FOR UPDATE OF s
    LOOP
        v_tomar := LEAST(v_pend, v_lote.saldo);
        INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
        VALUES (v_lote.lote_id, v_det.sucursal_id, v_det.producto_id, 'venta', -v_tomar, p_usuario_id)
        RETURNING id INTO v_mov;
        INSERT INTO venta_lote (venta_detalle_id, movimiento_id, sucursal_id, producto_id)
        VALUES (v_det.id, v_mov, v_det.sucursal_id, v_det.producto_id);
        v_pend  := v_pend - v_tomar;
        v_total := v_total + v_tomar;
        EXIT WHEN v_pend = 0;
    END LOOP;

    IF v_pend > 0 THEN
        RAISE EXCEPTION 'Stock insuficiente: faltan % unidades del producto % en la sucursal %',
            v_pend, v_det.producto_id, v_det.sucursal_id USING ERRCODE = 'INV01';
    END IF;
    RETURN v_total;
END;
$$;

-- Confirma una venta en borrador: asigna lotes por FEFO a todas sus lineas y la
-- congela. Todo o nada (una sola transaccion).
CREATE FUNCTION confirmar_venta(p_venta_id BIGINT, p_usuario_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    d RECORD;
BEGIN
    PERFORM 1 FROM venta WHERE id = p_venta_id AND estado = 'borrador' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La venta % no existe o ya no esta en borrador', p_venta_id;
    END IF;
    FOR d IN SELECT id FROM venta_detalle WHERE venta_id = p_venta_id ORDER BY id LOOP
        PERFORM asignar_fefo(d.id, p_usuario_id);
    END LOOP;
    UPDATE venta SET estado = 'confirmada', fecha = now() WHERE id = p_venta_id;
END;
$$;

-- Devuelve al stock, tras inspeccionarlo, lo acreditado en una linea de nota
-- credito, a los lotes de los que salio (en el orden de la asignacion).
CREATE FUNCTION reingresar_stock(p_nc_detalle_id BIGINT, p_cantidad NUMERIC, p_usuario_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_nc    RECORD;
    v_lote  RECORD;
    v_pend  NUMERIC := p_cantidad;
    v_tomar NUMERIC;
    v_mov   BIGINT;
BEGIN
    SELECT d.id, d.sucursal_id, d.venta_detalle_id, vd.producto_id INTO v_nc
      FROM nota_credito_detalle d JOIN venta_detalle vd ON vd.id = d.venta_detalle_id
     WHERE d.id = p_nc_detalle_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la linea de nota credito %', p_nc_detalle_id;
    END IF;

    FOR v_lote IN
        SELECT x.lote_id,
               SUM(abs(x.cantidad_con_signo))
               - COALESCE((SELECT SUM(r.cantidad)
                             FROM nota_credito_reingreso r
                             JOIN movimiento rm ON rm.id = r.movimiento_id
                             JOIN nota_credito_detalle rd ON rd.id = r.nota_credito_detalle_id
                            WHERE rd.venta_detalle_id = v_nc.venta_detalle_id
                              AND rm.lote_id = x.lote_id), 0) AS disponible
          FROM venta_lote vl JOIN movimiento x ON x.id = vl.movimiento_id
         WHERE vl.venta_detalle_id = v_nc.venta_detalle_id
         GROUP BY x.lote_id ORDER BY x.lote_id
    LOOP
        CONTINUE WHEN v_lote.disponible <= 0;
        v_tomar := LEAST(v_pend, v_lote.disponible);
        INSERT INTO movimiento (lote_id, sucursal_id, producto_id, tipo, cantidad_con_signo, usuario_id)
        VALUES (v_lote.lote_id, v_nc.sucursal_id, v_nc.producto_id, 'devolucion', v_tomar, p_usuario_id)
        RETURNING id INTO v_mov;
        INSERT INTO nota_credito_reingreso (nota_credito_detalle_id, sucursal_id, movimiento_id, cantidad)
        VALUES (v_nc.id, v_nc.sucursal_id, v_mov, v_tomar);
        v_pend := v_pend - v_tomar;
        EXIT WHEN v_pend = 0;
    END LOOP;

    IF v_pend > 0 THEN
        RAISE EXCEPTION 'No hay lotes de origen suficientes para reingresar % unidades', v_pend;
    END IF;
END;
$$;

-- ============================================================================
-- 5. RENTAS
-- ============================================================================

CREATE TABLE formato_cobro (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          VARCHAR(30) NOT NULL UNIQUE,
    minutos_periodo INTEGER NOT NULL CHECK (minutos_periodo > 0)    -- hora=60, dia=1440...
);

CREATE TABLE concepto_cargo_renta (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categoria_renta (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE producto_renta (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    categoria_renta_id  BIGINT NOT NULL REFERENCES categoria_renta (id),
    codigo              VARCHAR(60) NOT NULL UNIQUE,
    nombre              VARCHAR(180) NOT NULL,
    formato_cobro_id    BIGINT NOT NULL REFERENCES formato_cobro (id),
    precio              NUMERIC(12, 2) NOT NULL CHECK (precio >= 0),         -- por periodo
    impuesto_porcentaje NUMERIC(5, 2) NOT NULL DEFAULT 0
                        CHECK (impuesto_porcentaje BETWEEN 0 AND 100),
    deposito            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (deposito >= 0),
    reposicion          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (reposicion >= 0),
    activo              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE unidad_renta (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_renta_id BIGINT NOT NULL REFERENCES producto_renta (id),
    sucursal_id       BIGINT NOT NULL REFERENCES sucursal (id),
    codigo            VARCHAR(80) NOT NULL UNIQUE,
    estado            VARCHAR(20) NOT NULL DEFAULT 'disponible'
                      CHECK (estado IN ('disponible', 'rentada', 'mantenimiento', 'retirada')),
    UNIQUE (id, sucursal_id)
);
CREATE INDEX unidad_renta_estado_idx ON unidad_renta (sucursal_id, estado);

CREATE TABLE unidad_renta_nota (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unidad_renta_id BIGINT NOT NULL REFERENCES unidad_renta (id),
    usuario_id      BIGINT NOT NULL REFERENCES usuario (id),
    comentario      TEXT NOT NULL CHECK (length(btrim(comentario)) > 0),
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX unidad_renta_nota_unidad_idx ON unidad_renta_nota (unidad_renta_id, fecha DESC);
CREATE TRIGGER unidad_renta_nota_solo_insercion BEFORE UPDATE OR DELETE ON unidad_renta_nota
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

CREATE TABLE renta (
    id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sucursal_id               BIGINT NOT NULL REFERENCES sucursal (id),
    cliente_id                BIGINT NOT NULL REFERENCES cliente (id),
    usuario_abre_id           BIGINT NOT NULL REFERENCES usuario (id),
    usuario_cierra_id         BIGINT REFERENCES usuario (id),
    numero                    VARCHAR(60) NOT NULL,              -- R-00001
    fecha_inicio              TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_prevista_devolucion TIMESTAMPTZ NOT NULL,
    fecha_cierre              TIMESTAMPTZ,
    estado                    VARCHAR(20) NOT NULL DEFAULT 'abierta'
                              CHECK (estado IN ('abierta', 'cerrada', 'cancelada')),
    UNIQUE (sucursal_id, numero),
    UNIQUE (id, sucursal_id),
    CHECK (fecha_prevista_devolucion > fecha_inicio),
    CHECK ((estado = 'cerrada') = (fecha_cierre IS NOT NULL)),
    CHECK (estado <> 'cerrada' OR usuario_cierra_id IS NOT NULL)
);
CREATE INDEX renta_estado_idx ON renta (sucursal_id, estado);
CREATE INDEX renta_cliente_idx ON renta (cliente_id);
CREATE INDEX renta_vencimiento_idx ON renta (fecha_prevista_devolucion) WHERE estado = 'abierta';

-- Una linea por pieza fisica; cada una se devuelve por separado. Tarifa, impuesto
-- y deposito se copian de producto_renta al crear la linea.
CREATE TABLE renta_detalle (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renta_id            BIGINT NOT NULL,
    sucursal_id         BIGINT NOT NULL,
    unidad_renta_id     BIGINT NOT NULL,
    formato_cobro_id    BIGINT NOT NULL REFERENCES formato_cobro (id),
    tarifa_aplicada     NUMERIC(12, 2) NOT NULL CHECK (tarifa_aplicada >= 0),
    impuesto_porcentaje NUMERIC(5, 2) NOT NULL CHECK (impuesto_porcentaje BETWEEN 0 AND 100),
    deposito_aplicado   NUMERIC(12, 2) NOT NULL CHECK (deposito_aplicado >= 0),
    fecha_devolucion    TIMESTAMPTZ,
    periodos_cobrados   INTEGER CHECK (periodos_cobrados >= 0),
    estado_devolucion   VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                        CHECK (estado_devolucion IN ('pendiente', 'devuelta', 'danada', 'perdida', 'cancelada')),
    subtotal            NUMERIC(12, 2) GENERATED ALWAYS AS
                        (periodos_cobrados * tarifa_aplicada) STORED,
    impuesto            NUMERIC(12, 2) GENERATED ALWAYS AS
                        (round(periodos_cobrados * tarifa_aplicada * impuesto_porcentaje / 100, 2)) STORED,
    total               NUMERIC(12, 2) GENERATED ALWAYS AS
                        (periodos_cobrados * tarifa_aplicada
                         + round(periodos_cobrados * tarifa_aplicada * impuesto_porcentaje / 100, 2)) STORED,
    FOREIGN KEY (renta_id, sucursal_id) REFERENCES renta (id, sucursal_id),
    FOREIGN KEY (unidad_renta_id, sucursal_id) REFERENCES unidad_renta (id, sucursal_id),
    UNIQUE (renta_id, unidad_renta_id),
    CHECK ((estado_devolucion IN ('pendiente', 'cancelada')
            AND fecha_devolucion IS NULL AND periodos_cobrados IS NULL)
        OR (estado_devolucion IN ('devuelta', 'danada', 'perdida')
            AND fecha_devolucion IS NOT NULL AND periodos_cobrados IS NOT NULL))
);
CREATE INDEX renta_detalle_renta_idx ON renta_detalle (renta_id);
-- Una pieza no puede estar pendiente en dos rentas a la vez.
CREATE UNIQUE INDEX renta_unidad_pendiente_uq ON renta_detalle (unidad_renta_id)
    WHERE estado_devolucion = 'pendiente';

CREATE TABLE renta_cargo (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renta_detalle_id  BIGINT NOT NULL REFERENCES renta_detalle (id),
    concepto_cargo_id BIGINT NOT NULL REFERENCES concepto_cargo_renta (id),
    descripcion       TEXT,
    monto             NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
    usuario_id        BIGINT NOT NULL REFERENCES usuario (id),
    fecha             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX renta_cargo_detalle_idx ON renta_cargo (renta_detalle_id);

-- El deposito NO es ingreso: se cobra y se devuelve o se aplica a lo que se debe.
CREATE TABLE renta_pago (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renta_id   BIGINT NOT NULL REFERENCES renta (id),
    tipo       VARCHAR(30) NOT NULL
               CHECK (tipo IN ('deposito', 'cobro', 'devolucion_deposito', 'aplicacion_deposito')),
    metodo     VARCHAR(20) NOT NULL
               CHECK (metodo IN ('efectivo', 'transferencia', 'tarjeta', 'otro')),
    monto      NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
    referencia VARCHAR(120),
    usuario_id BIGINT NOT NULL REFERENCES usuario (id),
    fecha      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX renta_pago_renta_idx ON renta_pago (renta_id, fecha DESC);

-- ---------------------------------------------------------------------------
-- Triggers de rentas
-- ---------------------------------------------------------------------------

-- Abrir: cliente activo, desbloqueado y con telefono; nace abierta.
CREATE FUNCTION validar_cliente_renta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado <> 'abierta' THEN
        RAISE EXCEPTION 'Una renta siempre nace abierta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cliente c
                    WHERE c.id = NEW.cliente_id AND c.activo AND NOT c.bloqueado
                      AND length(btrim(coalesce(c.telefono, ''))) > 0) THEN
        RAISE EXCEPTION 'Para rentar, el cliente debe estar activo, desbloqueado y tener telefono';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_numero BEFORE INSERT ON renta
    FOR EACH ROW EXECUTE FUNCTION asignar_numero_documento('renta', 'R');
CREATE TRIGGER renta_validar_cliente BEFORE INSERT ON renta
    FOR EACH ROW EXECUTE FUNCTION validar_cliente_renta();

-- Al confirmar la transaccion de apertura: al menos una pieza y el deposito
-- exigido ya cobrado (para exonerarlo, la linea se crea con deposito_aplicado = 0).
CREATE FUNCTION verificar_renta_abierta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_requerido NUMERIC;
    v_cobrado   NUMERIC;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM renta_detalle WHERE renta_id = NEW.id) THEN
        RAISE EXCEPTION 'La renta % no tiene piezas', NEW.numero;
    END IF;
    SELECT COALESCE(SUM(deposito_aplicado), 0) INTO v_requerido
      FROM renta_detalle WHERE renta_id = NEW.id;
    SELECT COALESCE(SUM(monto), 0) INTO v_cobrado
      FROM renta_pago WHERE renta_id = NEW.id AND tipo = 'deposito';
    IF v_cobrado < v_requerido THEN
        RAISE EXCEPTION 'La renta % exige deposito de % y solo se cobro %', NEW.numero, v_requerido, v_cobrado;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER renta_abierta_completa AFTER INSERT ON renta
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verificar_renta_abierta();

-- Cuenta de la renta. consumo = piezas devueltas + cargos; saldo > 0: el cliente debe.
CREATE VIEW v_renta_saldo AS
SELECT r.id AS renta_id, r.numero, r.sucursal_id, r.cliente_id, r.estado,
       COALESCE(l.total, 0) AS total_piezas,
       COALESCE(c.total, 0) AS total_cargos,
       COALESCE(l.total, 0) + COALESCE(c.total, 0) AS consumo,
       COALESCE(p.deposito, 0) AS deposito_cobrado,
       COALESCE(p.devuelto, 0) AS deposito_devuelto,
       COALESCE(p.aplicado, 0) AS deposito_aplicado,
       COALESCE(p.deposito, 0) - COALESCE(p.devuelto, 0) - COALESCE(p.aplicado, 0) AS deposito_en_poder,
       COALESCE(p.cobros, 0) AS cobrado,
       COALESCE(l.total, 0) + COALESCE(c.total, 0)
         - COALESCE(p.cobros, 0) - COALESCE(p.aplicado, 0) AS saldo
  FROM renta r
  LEFT JOIN (SELECT renta_id, SUM(total) AS total FROM renta_detalle
              WHERE estado_devolucion IN ('devuelta', 'danada', 'perdida')
              GROUP BY renta_id) l ON l.renta_id = r.id
  LEFT JOIN (SELECT d.renta_id, SUM(x.monto) AS total
               FROM renta_cargo x JOIN renta_detalle d ON d.id = x.renta_detalle_id
              GROUP BY d.renta_id) c ON c.renta_id = r.id
  LEFT JOIN (SELECT renta_id,
                    SUM(monto) FILTER (WHERE tipo = 'deposito')            AS deposito,
                    SUM(monto) FILTER (WHERE tipo = 'devolucion_deposito') AS devuelto,
                    SUM(monto) FILTER (WHERE tipo = 'aplicacion_deposito') AS aplicado,
                    SUM(monto) FILTER (WHERE tipo = 'cobro')               AS cobros
               FROM renta_pago GROUP BY renta_id) p ON p.renta_id = r.id;

-- Cerrar o cancelar exige cuenta en cero y deposito devuelto o aplicado.
CREATE FUNCTION exigir_cuenta_saldada(p_renta_id BIGINT, p_numero TEXT, p_accion TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v RECORD;
BEGIN
    SELECT saldo, deposito_en_poder INTO v FROM v_renta_saldo WHERE renta_id = p_renta_id;
    IF v.saldo <> 0 THEN
        RAISE EXCEPTION 'No se puede % la renta %: su saldo es % (debe quedar en 0)', p_accion, p_numero, v.saldo;
    END IF;
    IF v.deposito_en_poder <> 0 THEN
        RAISE EXCEPTION 'No se puede % la renta %: quedan % de deposito sin devolver ni aplicar',
            p_accion, p_numero, v.deposito_en_poder;
    END IF;
END;
$$;

-- Renta abierta: solo cambian estado y datos de cierre.
CREATE FUNCTION controlar_renta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cambiables TEXT[] := ARRAY['estado', 'usuario_cierra_id', 'fecha_cierre'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Una renta no se borra: se cierra o se cancela';
    END IF;
    IF OLD.estado <> 'abierta' THEN
        RAISE EXCEPTION 'Una renta % ya no se puede modificar', OLD.estado;
    END IF;
    IF (to_jsonb(OLD) - v_cambiables) <> (to_jsonb(NEW) - v_cambiables) THEN
        RAISE EXCEPTION 'En una renta solo se puede cambiar el estado y los datos de cierre';
    END IF;

    IF NEW.estado = 'cerrada' THEN
        IF EXISTS (SELECT 1 FROM renta_detalle WHERE renta_id = OLD.id AND estado_devolucion = 'pendiente') THEN
            RAISE EXCEPTION 'No se puede cerrar la renta %: quedan piezas pendientes', OLD.numero;
        END IF;
        IF NEW.fecha_cierre < OLD.fecha_inicio THEN
            RAISE EXCEPTION 'La fecha de cierre no puede ser anterior al inicio de la renta';
        END IF;
        PERFORM exigir_cuenta_saldada(OLD.id, OLD.numero, 'cerrar');
    ELSIF NEW.estado = 'cancelada' THEN
        IF EXISTS (SELECT 1 FROM renta_detalle WHERE renta_id = OLD.id
                    AND estado_devolucion IN ('devuelta', 'danada', 'perdida')) THEN
            RAISE EXCEPTION 'No se puede cancelar la renta %: ya se devolvieron piezas; cierrela', OLD.numero;
        END IF;
        PERFORM exigir_cuenta_saldada(OLD.id, OLD.numero, 'cancelar');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_controlar BEFORE UPDATE OR DELETE ON renta
    FOR EACH ROW EXECUTE FUNCTION controlar_renta();

-- Al cancelar, las piezas pendientes quedan canceladas (y se liberan solas).
CREATE FUNCTION cancelar_lineas_de_renta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado = 'cancelada' AND OLD.estado = 'abierta' THEN
        UPDATE renta_detalle SET estado_devolucion = 'cancelada'
         WHERE renta_id = NEW.id AND estado_devolucion = 'pendiente';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER renta_cancelar_lineas AFTER UPDATE ON renta
    FOR EACH ROW EXECUTE FUNCTION cancelar_lineas_de_renta();

-- Linea nueva: renta abierta; copia formato, tarifa, impuesto y deposito de la ficha.
CREATE FUNCTION preparar_renta_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    v_p      RECORD;
BEGIN
    SELECT estado INTO v_estado FROM renta WHERE id = NEW.renta_id;
    IF v_estado IS DISTINCT FROM 'abierta' THEN
        RAISE EXCEPTION 'Solo se agregan piezas a una renta abierta';
    END IF;
    SELECT p.activo AS producto_activo, p.formato_cobro_id, p.precio, p.impuesto_porcentaje, p.deposito
      INTO v_p
      FROM unidad_renta u JOIN producto_renta p ON p.id = u.producto_renta_id
     WHERE u.id = NEW.unidad_renta_id;
    IF NOT FOUND OR NOT v_p.producto_activo THEN
        RAISE EXCEPTION 'La pieza % no existe o su producto esta inactivo', NEW.unidad_renta_id;
    END IF;
    IF NEW.formato_cobro_id     IS NULL THEN NEW.formato_cobro_id     := v_p.formato_cobro_id; END IF;
    IF NEW.tarifa_aplicada      IS NULL THEN NEW.tarifa_aplicada      := v_p.precio; END IF;
    IF NEW.impuesto_porcentaje  IS NULL THEN NEW.impuesto_porcentaje  := v_p.impuesto_porcentaje; END IF;
    IF NEW.deposito_aplicado    IS NULL THEN NEW.deposito_aplicado    := v_p.deposito; END IF;
    IF NEW.estado_devolucion <> 'pendiente' THEN
        RAISE EXCEPTION 'Una linea de renta nace pendiente';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_detalle_preparar BEFORE INSERT ON renta_detalle
    FOR EACH ROW EXECUTE FUNCTION preparar_renta_detalle();

-- Al agregar la pieza queda rentada (debe estar disponible).
CREATE FUNCTION rentar_unidad() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE unidad_renta SET estado = 'rentada'
     WHERE id = NEW.unidad_renta_id AND estado = 'disponible';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La pieza % no esta disponible para rentar', NEW.unidad_renta_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER renta_detalle_rentar AFTER INSERT ON renta_detalle
    FOR EACH ROW EXECUTE FUNCTION rentar_unidad();

-- Una linea pendiente solo pasa a devuelta/danada/perdida/cancelada; no se toca la
-- pieza ni la tarifa. Se devuelve con la renta abierta; se cancela con la renta cancelada.
CREATE FUNCTION controlar_renta_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cambiables TEXT[] := ARRAY['estado_devolucion', 'fecha_devolucion', 'periodos_cobrados',
                                 'subtotal', 'impuesto', 'total'];
    v_renta      RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Una linea de renta no se borra';
    END IF;
    IF OLD.estado_devolucion <> 'pendiente' THEN
        RAISE EXCEPTION 'La linea ya esta %, no se modifica', OLD.estado_devolucion;
    END IF;
    IF NEW.estado_devolucion = 'pendiente' THEN
        RAISE EXCEPTION 'Una linea pendiente solo puede pasar a devuelta, danada, perdida o cancelada';
    END IF;
    IF (to_jsonb(OLD) - v_cambiables) <> (to_jsonb(NEW) - v_cambiables) THEN
        RAISE EXCEPTION 'No se pueden cambiar la pieza, la tarifa ni otros datos de la linea';
    END IF;
    SELECT estado, fecha_inicio INTO v_renta FROM renta WHERE id = OLD.renta_id;
    IF NEW.estado_devolucion = 'cancelada' THEN
        IF v_renta.estado <> 'cancelada' THEN
            RAISE EXCEPTION 'Una linea solo se cancela cancelando la renta';
        END IF;
    ELSE
        IF v_renta.estado <> 'abierta' THEN
            RAISE EXCEPTION 'No se devuelven piezas de una renta %', v_renta.estado;
        END IF;
        IF NEW.fecha_devolucion < v_renta.fecha_inicio THEN
            RAISE EXCEPTION 'La devolucion no puede ser anterior al inicio de la renta';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_detalle_controlar BEFORE UPDATE OR DELETE ON renta_detalle
    FOR EACH ROW EXECUTE FUNCTION controlar_renta_detalle();

-- Al devolver, la pieza se actualiza sola:
--   devuelta -> disponible | danada -> mantenimiento | perdida -> retirada | cancelada -> disponible
CREATE FUNCTION liberar_unidad_renta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE unidad_renta
       SET estado = CASE NEW.estado_devolucion
                        WHEN 'devuelta'  THEN 'disponible'
                        WHEN 'danada'    THEN 'mantenimiento'
                        WHEN 'perdida'   THEN 'retirada'
                        WHEN 'cancelada' THEN 'disponible'
                    END
     WHERE id = NEW.unidad_renta_id AND estado = 'rentada';
    RETURN NULL;
END;
$$;
CREATE TRIGGER renta_detalle_liberar AFTER UPDATE ON renta_detalle
    FOR EACH ROW EXECUTE FUNCTION liberar_unidad_renta();

-- 'rentada' no se pone ni se quita a mano: solo lo hacen los triggers de la renta.
CREATE FUNCTION proteger_estado_unidad() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND (NEW.estado = 'rentada' OR OLD.estado = 'rentada')
       AND pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'El estado "rentada" lo gestiona la renta (abrir y devolver piezas); no se cambia a mano';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER unidad_renta_proteger_estado BEFORE UPDATE ON unidad_renta
    FOR EACH ROW EXECUTE FUNCTION proteger_estado_unidad();

-- Cargos y pagos: solo con la renta abierta; solo insercion.
CREATE FUNCTION validar_renta_cargo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT r.estado INTO v_estado
      FROM renta_detalle d JOIN renta r ON r.id = d.renta_id WHERE d.id = NEW.renta_detalle_id;
    IF v_estado IS DISTINCT FROM 'abierta' THEN
        RAISE EXCEPTION 'Los cargos solo se registran en una renta abierta (esta %)', v_estado;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_cargo_validar BEFORE INSERT ON renta_cargo
    FOR EACH ROW EXECUTE FUNCTION validar_renta_cargo();
CREATE TRIGGER renta_cargo_solo_insercion BEFORE UPDATE OR DELETE ON renta_cargo
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- Dinero de la renta. Reglas:
--   * devolucion_deposito / aplicacion_deposito: nunca mas que el deposito en poder.
--   * cobro / aplicacion_deposito: nunca mas que el saldo (piezas devueltas + cargos
--     - lo ya cobrado o aplicado). No se cobra por adelantado: para eso es el deposito.
CREATE FUNCTION validar_renta_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT;
    v        RECORD;
BEGIN
    SELECT estado INTO v_estado FROM renta WHERE id = NEW.renta_id FOR UPDATE;
    IF v_estado IS DISTINCT FROM 'abierta' THEN
        RAISE EXCEPTION 'Los pagos solo se registran en una renta abierta (esta %)', v_estado;
    END IF;
    SELECT saldo, deposito_en_poder INTO v FROM v_renta_saldo WHERE renta_id = NEW.renta_id;
    IF NEW.tipo IN ('devolucion_deposito', 'aplicacion_deposito') AND NEW.monto > v.deposito_en_poder THEN
        RAISE EXCEPTION 'Se usaria mas deposito del que se tiene (en poder %, nuevo %)', v.deposito_en_poder, NEW.monto;
    END IF;
    IF NEW.tipo IN ('cobro', 'aplicacion_deposito') AND NEW.monto > v.saldo THEN
        RAISE EXCEPTION 'El monto excede el saldo de la renta (saldo %, nuevo %)', v.saldo, NEW.monto;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER renta_pago_validar BEFORE INSERT ON renta_pago
    FOR EACH ROW EXECUTE FUNCTION validar_renta_pago();
CREATE TRIGGER renta_pago_solo_insercion BEFORE UPDATE OR DELETE ON renta_pago
    FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_historica();

-- ---------------------------------------------------------------------------
-- Funciones de rentas para el backend
-- ---------------------------------------------------------------------------

-- Periodos completos a cobrar, minimo 1. p_gracia_min = minutos de tolerancia que
-- NO generan un periodo extra.  Ej.: dia (1440), gracia 30:
--   08:00 -> dia 3 08:10 = 2 periodos | dia 3 09:00 = 3 periodos
CREATE FUNCTION periodos_a_cobrar(p_inicio TIMESTAMPTZ, p_fin TIMESTAMPTZ,
                                  p_minutos_periodo INTEGER, p_gracia_min INTEGER DEFAULT 0)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_fin < p_inicio THEN
        RAISE EXCEPTION 'La fecha final no puede ser anterior a la inicial';
    END IF;
    IF p_minutos_periodo IS NULL OR p_minutos_periodo <= 0 THEN
        RAISE EXCEPTION 'Los minutos del periodo deben ser positivos';
    END IF;
    RETURN GREATEST(1, ceil((EXTRACT(EPOCH FROM (p_fin - p_inicio)) / 60.0
                             - COALESCE(p_gracia_min, 0)) / p_minutos_periodo))::INTEGER;
END;
$$;

-- Devuelve una pieza: calcula los periodos con el formato copiado al abrir; los
-- triggers liberan la pieza y la base genera subtotal, impuesto y total.
CREATE FUNCTION devolver_pieza(p_renta_detalle_id BIGINT, p_estado VARCHAR,
                               p_fecha TIMESTAMPTZ DEFAULT now(), p_gracia_min INTEGER DEFAULT 0)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    v          RECORD;
    v_periodos INTEGER;
BEGIN
    IF p_estado NOT IN ('devuelta', 'danada', 'perdida') THEN
        RAISE EXCEPTION 'Estado de devolucion invalido: % (devuelta, danada o perdida)', p_estado;
    END IF;
    SELECT f.minutos_periodo, r.fecha_inicio INTO v
      FROM renta_detalle d
      JOIN renta r ON r.id = d.renta_id
      JOIN formato_cobro f ON f.id = d.formato_cobro_id
     WHERE d.id = p_renta_detalle_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la linea de renta %', p_renta_detalle_id;
    END IF;
    v_periodos := periodos_a_cobrar(v.fecha_inicio, p_fecha, v.minutos_periodo, p_gracia_min);
    UPDATE renta_detalle
       SET estado_devolucion = p_estado, fecha_devolucion = p_fecha, periodos_cobrados = v_periodos
     WHERE id = p_renta_detalle_id;
    RETURN v_periodos;
END;
$$;

CREATE FUNCTION cerrar_renta(p_renta_id BIGINT, p_usuario_id BIGINT, p_fecha TIMESTAMPTZ DEFAULT now())
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE renta SET estado = 'cerrada', usuario_cierra_id = p_usuario_id, fecha_cierre = p_fecha
     WHERE id = p_renta_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la renta %', p_renta_id;
    END IF;
END;
$$;

-- ============================================================================
-- 6. VISTAS
-- ============================================================================

-- Stock por producto y sucursal. Lo vencido no se vende: stock_bajo usa lo vendible.
CREATE VIEW v_stock AS
SELECT t.sucursal_id, t.producto_id, t.cantidad, t.cantidad_vencida,
       (t.cantidad - t.cantidad_vencida) AS cantidad_vendible,
       t.stock_minimo,
       (t.stock_minimo > 0 AND (t.cantidad - t.cantidad_vencida) <= t.stock_minimo) AS stock_bajo
  FROM (SELECT ps.sucursal_id, ps.producto_id, ps.stock_minimo,
               COALESCE(SUM(s.cantidad_actual), 0)::NUMERIC(12, 3) AS cantidad,
               COALESCE(SUM(s.cantidad_actual) FILTER (WHERE l.fecha_caducidad < CURRENT_DATE), 0)::NUMERIC(12, 3)
                   AS cantidad_vencida
          FROM producto_sucursal ps
          LEFT JOIN lote l ON l.producto_id = ps.producto_id AND l.sucursal_id = ps.sucursal_id
          LEFT JOIN lote_saldo s ON s.lote_id = l.id
         GROUP BY ps.sucursal_id, ps.producto_id, ps.stock_minimo) t;

CREATE VIEW v_lote_detalle AS
SELECT l.id AS lote_id, l.producto_id, l.sucursal_id, c.proveedor_id, c.id AS compra_id,
       l.costo_unitario, l.cantidad_inicial, s.cantidad_actual AS saldo,
       l.fecha_compra, l.fecha_caducidad,
       (l.fecha_caducidad - CURRENT_DATE) AS dias_para_vencer,
       (l.fecha_caducidad IS NOT NULL AND l.fecha_caducidad < CURRENT_DATE) AS vencido
  FROM lote l
  JOIN lote_saldo s ON s.lote_id = l.id
  JOIN compra_detalle d ON d.id = l.compra_detalle_id
  JOIN compra c ON c.id = d.compra_id;

-- Kardex valorado al costo real de cada lote.
CREATE VIEW v_kardex AS
SELECT m.id AS movimiento_id, m.fecha, m.sucursal_id, m.producto_id, m.lote_id, m.tipo, m.motivo,
       m.cantidad_con_signo AS cantidad, l.costo_unitario,
       round(m.cantidad_con_signo * l.costo_unitario, 2) AS valor, m.usuario_id
  FROM movimiento m JOIN lote l ON l.id = m.lote_id;

-- Control de integridad: DEBE devolver cero filas.
CREATE VIEW v_cuadre_lote AS
SELECT l.id AS lote_id, s.cantidad_actual AS saldo,
       COALESCE(m.total, 0) AS suma_movimientos,
       l.cantidad_inicial, COALESCE(m.compras, 0) AS suma_compras
  FROM lote l
  JOIN lote_saldo s ON s.lote_id = l.id
  LEFT JOIN (SELECT lote_id, SUM(cantidad_con_signo) AS total,
                    SUM(cantidad_con_signo) FILTER (WHERE tipo = 'compra') AS compras
               FROM movimiento GROUP BY lote_id) m ON m.lote_id = l.id
 WHERE s.cantidad_actual <> COALESCE(m.total, 0)
    OR l.cantidad_inicial <> COALESCE(m.compras, 0);

-- Totales de cabecera = suma de las lineas (importes ya redondeados por linea).
CREATE VIEW v_compra_totales AS
SELECT c.id AS compra_id, c.numero, c.sucursal_id, c.estado,
       COALESCE(SUM(d.subtotal), 0) AS subtotal,
       COALESCE(SUM(d.impuesto), 0) AS impuesto,
       COALESCE(SUM(d.total), 0)    AS total
  FROM compra c LEFT JOIN compra_detalle d ON d.compra_id = c.id
 GROUP BY c.id;

CREATE VIEW v_venta_totales AS
SELECT v.id AS venta_id, v.numero, v.sucursal_id, v.estado,
       COALESCE(SUM(d.subtotal), 0)  AS subtotal,
       COALESCE(SUM(d.descuento), 0) AS descuento,
       COALESCE(SUM(d.impuesto), 0)  AS impuesto,
       COALESCE(SUM(d.total), 0)     AS total
  FROM venta v LEFT JOIN venta_detalle d ON d.venta_id = v.id
 GROUP BY v.id;

CREATE VIEW v_nota_credito_totales AS
SELECT n.id AS nota_credito_id, n.numero, n.venta_id, n.sucursal_id, n.estado,
       COALESCE(SUM(d.subtotal), 0)  AS subtotal,
       COALESCE(SUM(d.descuento), 0) AS descuento,
       COALESCE(SUM(d.impuesto), 0)  AS impuesto,
       COALESCE(SUM(d.total), 0)     AS total
  FROM nota_credito n LEFT JOIN nota_credito_detalle d ON d.nota_credito_id = n.id
 GROUP BY n.id;

-- Cuentas por cobrar. saldo > 0: el cliente debe; saldo < 0: se le debe devolver.
CREATE VIEW v_venta_saldo AS
SELECT v.venta_id, v.numero, v.sucursal_id, v.total,
       COALESCE(nc.total, 0) AS total_acreditado,
       v.total - COALESCE(nc.total, 0) AS deuda_neta,
       COALESCE(p.pagado, 0) AS pagado_neto,
       v.total - COALESCE(nc.total, 0) - COALESCE(p.pagado, 0) AS saldo
  FROM v_venta_totales v
  LEFT JOIN (SELECT venta_id, SUM(total) AS total FROM v_nota_credito_totales
              WHERE estado = 'confirmada' GROUP BY venta_id) nc ON nc.venta_id = v.venta_id
  LEFT JOIN (SELECT venta_id, SUM(CASE tipo WHEN 'pago' THEN monto ELSE -monto END) AS pagado
               FROM venta_pago GROUP BY venta_id) p ON p.venta_id = v.venta_id
 WHERE v.estado = 'confirmada';

-- Margen bruto por linea con el costo real de los lotes usados. Un producto
-- devuelto danado (acreditado, sin reingreso) deja margen negativo.
CREATE VIEW v_venta_margen AS
SELECT vd.venta_id, vd.id AS venta_detalle_id, vd.sucursal_id, vd.producto_id, vd.cantidad,
       COALESCE(nc.cantidad, 0) AS cantidad_acreditada,
       (vd.subtotal - vd.descuento) AS ingreso_bruto,
       (vd.subtotal - vd.descuento) - COALESCE(nc.base, 0) AS ingreso_neto,
       COALESCE(a.costo, 0) - COALESCE(r.costo, 0) AS costo,
       (vd.subtotal - vd.descuento) - COALESCE(nc.base, 0)
         - (COALESCE(a.costo, 0) - COALESCE(r.costo, 0)) AS margen
  FROM venta_detalle vd
  JOIN venta v ON v.id = vd.venta_id AND v.estado = 'confirmada'
  LEFT JOIN (SELECT d.venta_detalle_id, SUM(d.cantidad) AS cantidad, SUM(d.subtotal - d.descuento) AS base
               FROM nota_credito_detalle d JOIN nota_credito n ON n.id = d.nota_credito_id
              WHERE n.estado = 'confirmada' GROUP BY d.venta_detalle_id) nc ON nc.venta_detalle_id = vd.id
  LEFT JOIN (SELECT vl.venta_detalle_id, SUM(abs(m.cantidad_con_signo) * l.costo_unitario) AS costo
               FROM venta_lote vl JOIN movimiento m ON m.id = vl.movimiento_id
               JOIN lote l ON l.id = m.lote_id GROUP BY vl.venta_detalle_id) a ON a.venta_detalle_id = vd.id
  LEFT JOIN (SELECT d.venta_detalle_id, SUM(r.cantidad * l.costo_unitario) AS costo
               FROM nota_credito_reingreso r
               JOIN nota_credito_detalle d ON d.id = r.nota_credito_detalle_id
               JOIN movimiento m ON m.id = r.movimiento_id
               JOIN lote l ON l.id = m.lote_id GROUP BY d.venta_detalle_id) r ON r.venta_detalle_id = vd.id;

-- Piezas pendientes de una renta abierta cuya fecha prevista ya paso.
CREATE VIEW v_renta_vencida AS
SELECT r.id AS renta_id, r.numero, r.sucursal_id, r.cliente_id, d.id AS renta_detalle_id,
       d.unidad_renta_id, r.fecha_prevista_devolucion, now() - r.fecha_prevista_devolucion AS retraso
  FROM renta r JOIN renta_detalle d ON d.renta_id = r.id
 WHERE r.estado = 'abierta' AND d.estado_devolucion = 'pendiente'
   AND r.fecha_prevista_devolucion < now();

-- ============================================================================
-- 7. DOCUMENTACION (visible en pgAdmin y con \d+ en psql)
-- ============================================================================

COMMENT ON TABLE categoria_empleado IS 'Rol del usuario (owner, admin_sucursal). nivel_poder ordena la jerarquia; los permisos finos se validan en el backend.';
COMMENT ON TABLE auditoria IS 'Historial compartido de acciones. Solo insercion. sucursal_id NULL = general; usuario_id NULL = sistema.';
COMMENT ON TABLE documento_consecutivo IS 'Ultimo numero usado por sucursal y tipo de documento.';
COMMENT ON TABLE compra IS 'Mercancia recibida. borrador -> recibida (crea lotes) -> anulada (solo con compra_anulacion).';
COMMENT ON TABLE compra_detalle IS 'Linea de compra; subtotal, impuesto y total son columnas generadas. Editable solo en borrador.';
COMMENT ON TABLE lote IS 'Lo que llego en una linea de compra. Inmutable; solo nace al recibir la compra.';
COMMENT ON TABLE lote_saldo IS 'Cuanto queda de cada lote. Lo actualiza el kardex; nunca negativo.';
COMMENT ON TABLE movimiento IS 'Kardex: cantidad con signo (positiva entra, negativa sale). Solo insercion; un error se corrige con el movimiento contrario.';
COMMENT ON TABLE compra_anulacion IS 'Anula una compra recibida (una sola vez). Un trigger genera los movimientos contrarios; falla (INV02) si parte del stock ya salio.';
COMMENT ON TABLE venta IS 'borrador -> confirmada (confirmar_venta asigna lotes FEFO). Confirmada queda congelada; se corrige con nota credito.';
COMMENT ON TABLE venta_detalle IS 'Linea de venta. Precio e impuesto se copian del catalogo; importes generados por la base. descuento = monto calculado del porcentaje.';
COMMENT ON TABLE venta_lote IS 'De que lotes salio cada linea (liga linea con movimiento de venta). Trazabilidad y costo real.';
COMMENT ON TABLE nota_credito IS 'Hecho financiero que reduce lo vendido. No mueve stock por si sola; el regreso fisico es nota_credito_reingreso.';
COMMENT ON TABLE nota_credito_detalle IS 'Lineas acreditadas; los importes los calcula la base en proporcion y no acreditan mas de lo vendido.';
COMMENT ON TABLE nota_credito_reingreso IS 'Entrada fisica al stock tras inspeccionar la devolucion; vuelve al lote del que salio.';
COMMENT ON TABLE venta_pago IS 'Pagos y reembolsos (un reembolso nace de una nota credito). No se cobra mas de la deuda neta.';
COMMENT ON TABLE formato_cobro IS 'Como se cobra la renta (hora, dia...). minutos_periodo permite calcular los periodos.';
COMMENT ON TABLE producto_renta IS 'Ficha del articulo rentable. reposicion = lo que cuesta perderlo; deposito = lo que se retiene al rentar.';
COMMENT ON TABLE unidad_renta IS 'Pieza fisica rentable. Su estado "rentada" lo gestiona la renta.';
COMMENT ON TABLE renta IS 'Nace abierta; se cierra con cuenta en cero y deposito liquidado, o se cancela si no se devolvio nada.';
COMMENT ON TABLE renta_detalle IS 'Una pieza de la renta, devuelta por separado. Tarifa, impuesto y deposito se copian al abrir.';
COMMENT ON COLUMN renta_detalle.periodos_cobrados IS 'Periodos completos a cobrar. Lo calcula devolver_pieza() con periodos_a_cobrar().';
COMMENT ON TABLE renta_cargo IS 'Cargos extra (dano, retraso, perdida) sobre una pieza. Solo insercion.';
COMMENT ON TABLE renta_pago IS 'Dinero de la renta. El deposito no es ingreso: se cobra y se devuelve o se aplica. Solo insercion.';
COMMENT ON FUNCTION asignar_fefo(BIGINT, BIGINT) IS 'Asigna lotes a una linea por FEFO/FIFO saltando vencidos. INV01 si falta stock.';
COMMENT ON FUNCTION confirmar_venta(BIGINT, BIGINT) IS 'Asigna lotes a todas las lineas y confirma la venta, todo o nada.';
COMMENT ON FUNCTION reingresar_stock(BIGINT, NUMERIC, BIGINT) IS 'Devuelve al stock lo acreditado en una linea de nota credito, a sus lotes de origen.';
COMMENT ON FUNCTION periodos_a_cobrar(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) IS 'Periodos completos a cobrar (minimo 1) con minutos de gracia.';
COMMENT ON FUNCTION devolver_pieza(BIGINT, VARCHAR, TIMESTAMPTZ, INTEGER) IS 'Devuelve una pieza: calcula periodos y deja la linea devuelta/danada/perdida.';
COMMENT ON VIEW v_stock IS 'Stock por producto y sucursal; lo vencido no cuenta como vendible.';
COMMENT ON VIEW v_cuadre_lote IS 'Control de integridad: DEBE devolver cero filas.';
COMMENT ON VIEW v_venta_saldo IS 'Cuentas por cobrar. saldo > 0: el cliente debe; saldo < 0: se le debe devolver.';
COMMENT ON VIEW v_venta_margen IS 'Margen bruto por linea con el costo real de los lotes; descuenta notas credito y reingresos.';
COMMENT ON VIEW v_renta_saldo IS 'Estado de cuenta de cada renta: consumo, cobrado, deposito en poder y saldo.';
COMMENT ON VIEW v_renta_vencida IS 'Piezas pendientes cuya fecha prevista ya paso.';

COMMIT;
