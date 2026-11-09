// Permisos del usuario actual, para esconder botones y formularios que su rol no puede usar.
// El servidor siempre valida: esto es solo para no mostrar lo que no sirve.
import { useEffect, useState } from 'react';
import { api } from './api';

export function usePermisos() {
  const [yo, setYo] = useState(null);
  useEffect(() => {
    api('GET', '/auth/yo').then(setYo).catch(() => {});
  }, []);
  // puede('a', 'b') = tiene AL MENOS UNO de esos permisos
  const puede = (...codigos) => !!yo && codigos.some((c) => yo.permisos?.includes(c));
  return { yo, puede, cargado: !!yo };
}
