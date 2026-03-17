require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

async function migrate() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '001_init.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ Migration completed');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
