const { Pool } = require('pg');

// Only use SSL for Cloud SQL (IP address pattern), not for local docker containers
const needsSSL = process.env.DB_HOST && /^\d+\.\d+\.\d+\.\d+$/.test(process.env.DB_HOST);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
