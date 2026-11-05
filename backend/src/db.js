require('dotenv').config();
const { Pool, types } = require('pg');
// BIGINT (oid 20) llega como texto; nuestros ids caben de sobra en un Number.
types.setTypeParser(20, (v) => Number(v));
// DATE (oid 1082): se entrega tal cual ("2027-06-30"), sin convertirla a hora local.
types.setTypeParser(1082, (v) => v);
module.exports = new Pool({ connectionString: process.env.DATABASE_URL });
