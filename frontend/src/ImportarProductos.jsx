// Importar productos desde un CSV (Excel > Guardar como CSV). Primero simula y muestra los errores por fila.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import Campo from './Campo';

const clave = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  categoria: 'categoria', codigo: 'codigo', sku: 'codigo', nombre: 'nombre', producto: 'nombre', descripcion: 'nombre',
  codigobarras: 'codigo_barras', barras: 'codigo_barras', ean: 'codigo_barras',
  unidad: 'medida', medida: 'medida', presentacion: 'medida',
  iva: 'impuesto_porcentaje', impuesto: 'impuesto_porcentaje',
  caduca: 'maneja_caducidad', vence: 'maneja_caducidad', caducidad: 'maneja_caducidad',
  precio: 'precio_venta', precioventa: 'precio_venta',
  minimo: 'stock_minimo', stockminimo: 'stock_minimo',
};

// CSV con comas o punto y coma, comillas y BOM.
function parsearCSV(texto) {
  const t = texto.replace(/^\uFEFF/, '');
  const primera = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = []; let campo = ''; let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

// "12.500" / "12,5" / "12500" -> numero. Si no se entiende, se manda el texto para que el servidor lo marque.
function numero(v) {
  let s = String(v ?? '').trim().replace(/[$\s]/g, '');
  if (s === '') return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : String(v);
}
function booleano(v) {
  const s = clave(v);
  if (s === '') return null;
  if (['si', 's', 'true', '1', 'x', 'yes', 'y'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return String(v);
}

function aFilas(matriz) {
  if (matriz.length < 2) return { vacio: true };
  const [cab, ...datos] = matriz;
  const cols = cab.map((h) => ALIAS[clave(h)] || null);
  const faltan = ['categoria', 'codigo', 'nombre'].filter((k) => !cols.includes(k));
  if (faltan.length) return { faltan };
  const filas = datos.map((fila) => {
    const o = {};
    cols.forEach((k, i) => { if (k) o[k] = (fila[i] ?? '').trim(); });
    for (const k of ['impuesto_porcentaje', 'precio_venta', 'stock_minimo']) o[k] = numero(o[k]);
    o.maneja_caducidad = booleano(o.maneja_caducidad);
    return o;
  });
  return { filas };
}

function descargarPlantilla() {
  const csv = '\uFEFFcategoria;codigo;nombre;codigo_barras;unidad;iva;caduca;precio;minimo\n' +
    'Aseo;JAB-100;Jabón líquido 1L;7701234567890;botella;19;no;12000;10\n' +
    'Alimentos;ARR-100;Arroz 500g;;bolsa;0;si;3200;20\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'plantilla-productos.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function ImportarProductos() {
  const { t } = useTranslation();
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [filas, setFilas] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState('');
  const [listo, setListo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [vuelta, setVuelta] = useState(0); // para limpiar el selector de archivo

  useEffect(() => {
    api('GET', '/sucursales')
      .then((s) => { setSucursales(s); if (s.length) setSucursal(String(s[0].id)); })
      .catch(() => {});
  }, []);

  async function simular(f, suc) {
    setError(''); setListo(''); setTrabajando(true);
    try {
      setReporte(await api('POST', '/catalogo/importar', { simular: true, sucursal_id: suc ? Number(suc) : null, filas: f }));
    } catch (e) { setReporte(null); setError(e.message); }
    setTrabajando(false);
  }

  async function alElegir(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setListo(''); setError(''); setReporte(null); setFilas(null);
    try {
      const buf = await archivo.arrayBuffer();
      let texto;
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (err) { texto = new TextDecoder('windows-1252').decode(buf); }
      const r = aFilas(parsearCSV(texto));
      if (r.vacio) { setError(t('importar.vacio')); return; }
      if (r.faltan) { setError(t('importar.faltanColumnas', { cols: r.faltan.join(', ') })); return; }
      setFilas(r.filas);
      await simular(r.filas, sucursal);
    } catch (err) { setError(err.message); }
  }

  async function confirmar() {
    setError(''); setTrabajando(true);
    try {
      const r = await api('POST', '/catalogo/importar',
        { simular: false, sucursal_id: sucursal ? Number(sucursal) : null, filas });
      setListo(t('importar.listo', { n: r.importados, c: r.categorias_creadas }));
      setFilas(null); setReporte(null); setVuelta((v) => v + 1);
    } catch (e) { setError(e.message); }
    setTrabajando(false);
  }

  const res = reporte?.resumen;
  const malas = reporte ? reporte.filas.filter((f) => f.errores.length) : [];

  return (
    <details className="importar">
      <summary>{t('importar.titulo')}</summary>
      <p className="suave">{t('importar.explicacion')}</p>
      <div className="controles-importar">
        <button type="button" className="secundario" onClick={descargarPlantilla}>{t('importar.plantilla')}</button>
        <Campo etiqueta={t('importar.sucursal')} ayuda={t('importar.ayudaSucursal')}>
          <select value={sucursal} onChange={(e) => { setSucursal(e.target.value); if (filas) simular(filas, e.target.value); }}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={t('importar.archivo')} ayuda={t('importar.ayudaArchivo')}>
          <input key={vuelta} type="file" accept=".csv,text/csv" onChange={alElegir} />
        </Campo>
      </div>
      {trabajando && <p className="suave">{t('importar.procesando')}</p>}
      {error && <p className="error">{error}</p>}
      {listo && (
        <p className="aviso">{listo} <button type="button" className="secundario" onClick={() => window.location.reload()}>{t('importar.ver')}</button></p>
      )}
      {res && (
        <div>
          <p><strong>{t('importar.resumen', { total: res.total, ok: res.correctas, mal: res.con_error })}</strong></p>
          {res.categorias_nuevas.length > 0 && (
            <p className="suave">{t('importar.categoriasNuevas', { lista: res.categorias_nuevas.join(', ') })}</p>
          )}
          {malas.length > 0 && (
            <div className="tabla-caja">
              <table>
                <thead><tr><th>{t('importar.thFila')}</th><th>{t('importar.thCodigo')}</th><th>{t('importar.thNombre')}</th><th>{t('importar.thProblemas')}</th></tr></thead>
                <tbody>
                  {malas.slice(0, 100).map((f) => (
                    <tr key={f.fila}><td>{f.fila}</td><td>{f.codigo}</td><td>{f.nombre}</td><td>{f.errores.join('. ')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {malas.length > 100 && <p className="suave">{t('importar.masErrores')}</p>}
          <div className="acciones">
            <button type="button" disabled={res.con_error > 0 || trabajando} onClick={confirmar}>
              {t('importar.confirmar', { n: res.correctas })}</button>
            {res.con_error > 0 && <span className="suave">{t('importar.corrige')}</span>}
          </div>
        </div>
      )}
    </details>
  );
}
