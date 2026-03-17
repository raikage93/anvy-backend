require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

async function seed() {
  try {
    // Run migration first
    const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/001_init.sql'), 'utf-8');
    await pool.query(migrationSql);
    console.log('✅ Migration completed');

    // Seed admin user
    const hashedPassword = await bcrypt.hash('admin', 10);
    
    await pool.query(
      `INSERT INTO users (username, password, role) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (username) DO UPDATE SET password = $2, role = $3`,
      ['admin', hashedPassword, 'admin']
    );
    console.log('✅ Admin user seeded (username: admin, password: admin)');

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
