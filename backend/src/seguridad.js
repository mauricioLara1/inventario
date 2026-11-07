const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

// Seguridad basica: cabeceras, CORS por lista blanca y freno a los intentos de login.
// Se aplica antes de las rutas: require('./seguridad')(app).
module.exports = function aplicarSeguridad(app) {
  app.use(helmet());

  // CORS: solo los origenes de CORS_ORIGINS (separados por coma). Por defecto, Vite en desarrollo.
  const origenes = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origenes, methods: ['GET', 'POST', 'PUT', 'DELETE'] }));

  // Login: 10 intentos FALLIDOS por IP cada 15 minutos (los que aciertan no cuentan).
  app.use('/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos' },
  }));
};
