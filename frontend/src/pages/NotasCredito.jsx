import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { pesos, fecha } from '../formato';
import { useTranslation } from 'react-i18next';

const CLASE = { borrador: 'neutra', confirmada: 'buena' };

export default function NotasCredito() {
  const { t } = useTranslation();
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
      <h2>{t('menu.notas-credito')}</h2>
      <p className="suave">{t('notasCredito.nota')}</p>
      <div className="filtros">
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">{t('comun.todosEstados')}</option>
          <option value="borrador">{t('estados.borrador')}</option>
          <option value="confirmada">{t('estados.confirmada')}</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tabla-caja">
        <table>
          <thead><tr><th>{t('comun.numero')}</th><th>{t('comun.fecha')}</th><th>{t('notasCredito.venta')}</th><th>{t('notasCredito.motivo')}</th><th>{t('comun.estado')}</th><th className="num">{t('comun.total')}</th></tr></thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.id}>
                <td><Link to={`/notas-credito/${n.id}`}>{n.numero}</Link></td>
                <td>{fecha(n.fecha)}</td>
                <td><Link to={`/ventas/${n.venta_id}`}>{t('notasCredito.verVenta')}</Link></td>
                <td>{n.motivo}</td>
                <td><span className={`etiqueta ${CLASE[n.estado] ?? 'neutra'}`}>{t('estados.' + n.estado, { defaultValue: n.estado })}</span></td>
                <td className="num">{pesos(n.total)}</td>
              </tr>
            ))}
            {notas.length === 0 && <tr><td colSpan="6" className="vacio">{t('notasCredito.sinNotas')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
