require('dotenv').config();
const { Pool, types } = require('pg');
// BIGINT (oid 20) llega como texto; nuestros ids caben de sobra en un Number.
types.setTypeParser(20, (v) => Number(v));
module.exports = new Pool({ connectionString: process.env.DATABASE_URL });
