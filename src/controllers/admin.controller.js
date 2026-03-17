const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function getDefaultAccount(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM default_accounts ORDER BY id DESC LIMIT 1');
    if (!result.rows[0]) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function upsertDefaultAccount(req, res, next) {
  try {
    const { bank_bin, bank_name, bank_logo, account_no, description } = req.body;
    if (!bank_bin || !bank_name || !account_no) {
      return res.status(400).json({ error: 'bank_bin, bank_name, account_no required' });
    }

    const existing = await pool.query('SELECT id FROM default_accounts LIMIT 1');

    let result;
    if (existing.rows[0]) {
      result = await pool.query(
        `UPDATE default_accounts 
         SET bank_bin=$1, bank_name=$2, bank_logo=$3, account_no=$4, description=$5, updated_by=$6, updated_at=NOW() 
         WHERE id=$7 RETURNING *`,
        [bank_bin, bank_name, bank_logo, account_no, description || '', req.user.id, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO default_accounts (bank_bin, bank_name, bank_logo, account_no, description, updated_by) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [bank_bin, bank_name, bank_logo, account_no, description || '', req.user.id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDefaultAccount, upsertDefaultAccount, changePassword };
