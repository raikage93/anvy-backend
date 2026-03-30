const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/001_init.sql'), 'utf-8');
  await pool.query(sql);
}

module.exports = { ensureSchema };
