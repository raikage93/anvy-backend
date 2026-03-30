const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { normalizeAvailabilityRow, timeToMinutes } = require('../utils/availability');

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
      return res.status(400).json({ error: 'Thiếu thông tin tài khoản mặc định.' });
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
      return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' });
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 4 ký tự.' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác.' });

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);

    res.json({ message: 'Đổi mật khẩu thành công.' });
  } catch (err) {
    next(err);
  }
}

async function listAppointments(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, phone, appointment_time, notes, status, created_at
       FROM appointments
       ORDER BY appointment_time ASC, created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function getAvailabilitySettings(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT weekday, label, enabled, start_time, end_time
       FROM availability_settings
       ORDER BY CASE WHEN weekday = 0 THEN 7 ELSE weekday END`
    );

    res.json(result.rows.map(normalizeAvailabilityRow));
  } catch (err) {
    next(err);
  }
}

async function updateAvailabilitySettings(req, res, next) {
  const client = await pool.connect();

  try {
    const { settings } = req.body;

    if (!Array.isArray(settings) || settings.length !== 7) {
      return res.status(400).json({ error: 'Danh sách lịch làm việc không hợp lệ.' });
    }

    await client.query('BEGIN');

    for (const rawSetting of settings) {
      const weekday = Number(rawSetting.weekday);
      const enabled = Boolean(rawSetting.enabled);
      const startTime = rawSetting.start_time ? String(rawSetting.start_time).slice(0, 5) : null;
      const endTime = rawSetting.end_time ? String(rawSetting.end_time).slice(0, 5) : null;

      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Có ngày trong tuần không hợp lệ.' });
      }

      if (enabled) {
        const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!timePattern.test(startTime || '') || !timePattern.test(endTime || '')) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Khung giờ làm việc không hợp lệ.' });
        }

        if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Giờ bắt đầu phải sớm hơn giờ kết thúc.' });
        }
      }

      await client.query(
        `UPDATE availability_settings
         SET enabled = $1, start_time = $2, end_time = $3, updated_at = NOW()
         WHERE weekday = $4`,
        [enabled, enabled ? startTime : null, enabled ? endTime : null, weekday]
      );
    }

    await client.query('COMMIT');

    const result = await client.query(
      `SELECT weekday, label, enabled, start_time, end_time
       FROM availability_settings
       ORDER BY CASE WHEN weekday = 0 THEN 7 ELSE weekday END`
    );

    res.json(result.rows.map(normalizeAvailabilityRow));
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  getDefaultAccount,
  upsertDefaultAccount,
  changePassword,
  listAppointments,
  getAvailabilitySettings,
  updateAvailabilitySettings,
};
