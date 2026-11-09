// Buscador con autocompletado: escribes, el servidor devuelve pocas coincidencias y eliges una.
// Sirve para productos, clientes, etc. Con lector de codigo de barras: escanea y el lector da Enter.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function BuscadorBase({ valor, onChange, buscar, titulo, detalle, deshabilitado, exacto, placeholder, requerido }) {
  const { t } = useTranslation();
  const [texto, setTexto] = useState('');
  const [items, setItems] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const [cargando, setCargando] = useState(false);
  const turno = useRef(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    if (valor || !abierto) return undefined;
    const mio = ++turno.current;
    setCargando(true);
    const espera = setTimeout(async () => {
      try {
        const r = await buscarRef.current(texto.trim());
        if (mio === turno.current) { setItems(r.slice(0, 15)); setActivo(0); }
      } catch (e) {
        if (mio === turno.current) setItems([]);
      } finally {
        if (mio === turno.current) setCargando(false);
      }
    }, texto ? 250 : 0);
    return () => clearTimeout(espera);
  }, [texto, abierto, valor]);

  const bloqueado = (x) => (deshabilitado ? deshabilitado(x) : false);
  const elegir = (x) => { onChange(x); setTexto(''); setItems([]); setAbierto(false); };

  async function teclas(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setAbierto(true);
      setActivo((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Escape') {
      setAbierto(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = texto.trim();
      let elegido = null;
      try {
        if (q && exacto) elegido = (await buscarRef.current(q)).find((x) => exacto(x, q)) ?? null;
      } catch (err) { /* si falla, se usa la lista */ }
      if (!elegido) elegido = items[activo] ?? null;
      if (elegido && !bloqueado(elegido)) elegir(elegido);
    }
  }

  if (valor) {
    return (
      <span className="buscador-sel">
        <span>{titulo(valor)}</span>
        <button type="button" className="x" title={t('buscador.quitar')} onClick={() => onChange(null)}>×</button>
      </span>
    );
  }
  return (
    <span className="buscador">
      <input value={texto} placeholder={placeholder} required={requerido} autoComplete="off"
             onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
             onFocus={() => setAbierto(true)}
             onBlur={() => setTimeout(() => setAbierto(false), 150)}
             onKeyDown={teclas} />
      {abierto && (
        <ul className="buscador-lista" role="listbox">
          {items.length === 0 && (
            <li className="buscador-info">{cargando ? t('buscador.buscando') : t('buscador.sinResultados')}</li>
          )}
          {items.map((x, i) => (
            <li key={x.id} role="option" aria-selected={i === activo}
                className={(i === activo ? 'activo ' : '') + (bloqueado(x) ? 'off' : '')}
                onMouseDown={(e) => { e.preventDefault(); if (!bloqueado(x)) elegir(x); }}
                onMouseEnter={() => setActivo(i)}>
              <span>{titulo(x)}</span>
              {detalle && <span className="buscador-det">{detalle(x)}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

// Con etiqueta (y ayuda opcional) se ve igual que un Campo: nombre arriba y la "i" con la explicacion.
// No usa <label> para que un clic en el nombre no active el boton de quitar.
export default function Buscador({ etiqueta, ayuda, ...resto }) {
  const caja = <BuscadorBase {...resto} />;
  if (!etiqueta) return caja;
  return (
    <div className="campo-f">
      <span className="campo-et">
        {etiqueta}
        {ayuda && (
          <span className="ayuda" tabIndex={0}>
            i<span className="globo" role="tooltip">{ayuda}</span>
          </span>
        )}
      </span>
      {caja}
    </div>
  );
}
