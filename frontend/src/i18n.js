import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './idiomas/es.json';
import en from './idiomas/en.json';

let guardado = 'es';
try { guardado = localStorage.getItem('idioma') || 'es'; } catch { /* sin almacenamiento */ }

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: guardado,
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (idioma) => {
  try { localStorage.setItem('idioma', idioma); } catch { /* sin almacenamiento */ }
});

export default i18n;
