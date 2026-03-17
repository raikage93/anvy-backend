const pool = require('../config/db');

async function getDefaultAccount(req, res, next) {
  try {
    const result = await pool.query('SELECT bank_bin, bank_name, bank_logo, account_no, description FROM default_accounts ORDER BY id DESC LIMIT 1');
    if (!result.rows[0]) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { getDefaultAccount };
