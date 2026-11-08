// Casilla con su nombre visible arriba y, opcionalmente, una "i" con una explicacion.
export default function Campo({ etiqueta, ayuda, children }) {
  return (
    <label className="campo-f">
      <span className="campo-et">
        {etiqueta}
        {ayuda && (
          <span className="ayuda" tabIndex={0}>
            i<span className="globo" role="tooltip">{ayuda}</span>
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
