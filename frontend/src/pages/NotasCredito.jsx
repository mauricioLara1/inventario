import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { pesos, fecha } from '../formato';

const CLASE = { borrador: 'neutra', confirmada: 'buena' };

export default function NotasCredito() {
  const [notas, setNotas] = useState([]);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', `/notas-credito${estado ? `?estado=${estado}` : ''}`)
      .then((n) => { setNotas(n); setError(''); })
      .catch((e) => setError(e.message));
  }, [estado]);

  return (
    <>
      <h2>Notas crédito</h2>
      <p className="suave">Una nota crédito se crea desde una venta confirmada (botón dentro de la venta).</p>
      <div className="filtros">
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="confirmada">Confirmada</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Venta</th><th>Motivo</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.id}>
                <td><Link to={`/notas-credito/${n.id}`}>{n.numero}</Link></td>
                <td>{fecha(n.fecha)}</td>
                <td><Link to={`/ventas/${n.venta_id}`}>Ver venta</Link></td>
                <td>{n.motivo}</td>
                <td><span className={`etiqueta ${CLASE[n.estado] ?? 'neutra'}`}>{n.estado}</span></td>
                <td className="num">{pesos(n.total)}</td>
              </tr>
            ))}
            {notas.length === 0 && <tr><td colSpan="6" className="vacio">Sin notas crédito</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
