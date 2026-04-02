const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { normalizeAvailabilityRow, timeToMinutes } = require('../utils/availability');
const { normalizePrizeRow, isValidHexColor, normalizeWheelSettingsRow } = require('../utils/wheel');

function validatePrizePayload(body) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const color = String(body.color || '').trim();
  const totalQuantity = Number(body.total_quantity);
  const remainingQuantity = Number(body.remaining_quantity);
  const sortOrder = Number(body.sort_order || 0);
  const isActive = body.is_active !== false;

  if (!name) {
    return { error: 'Vui lòng nhập tên giải thưởng.' };
  }

  if (!Number.isInteger(totalQuantity) || totalQuantity < 0) {
    return { error: 'Tổng số lượng phải là số nguyên không âm.' };
  }

  if (!Number.isInteger(remainingQuantity) || remainingQuantity < 0) {
    return { error: 'Số lượng còn lại phải là số nguyên không âm.' };
  }

  if (remainingQuantity > totalQuantity) {
    return { error: 'Số lượng còn lại không được lớn hơn tổng số lượng.' };
  }

  if (!Number.isInteger(sortOrder)) {
    return { error: 'Thứ tự hiển thị không hợp lệ.' };
  }

  if (!isValidHexColor(color)) {
    return { error: 'Màu hiển thị phải là mã HEX hợp lệ.' };
  }

  return {
    value: {
      name,
      description,
      color,
      totalQuantity,
      remainingQuantity,
      sortOrder,
      isActive,
    },
  };
}

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

async function listWheelPrizes(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, name, description, total_quantity, remaining_quantity, color, is_active, sort_order, created_at, updated_at
       FROM wheel_prizes
       ORDER BY is_active DESC, sort_order ASC, id ASC`
    );

    res.json(result.rows.map(normalizePrizeRow));
  } catch (err) {
    next(err);
  }
}

async function getWheelSettings(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT max_daily_spins_per_phone, updated_at
       FROM wheel_settings
       WHERE id = 1`
    );

    res.json(normalizeWheelSettingsRow(result.rows[0] || { max_daily_spins_per_phone: 1 }));
  } catch (err) {
    next(err);
  }
}

async function updateWheelSettings(req, res, next) {
  try {
    const maxDailySpins = Number(req.body.max_daily_spins_per_phone);

    if (!Number.isInteger(maxDailySpins) || maxDailySpins < 1 || maxDailySpins > 20) {
      return res.status(400).json({ error: 'Giới hạn lượt chơi mỗi ngày phải là số nguyên từ 1 đến 20.' });
    }

    const result = await pool.query(
      `INSERT INTO wheel_settings (id, max_daily_spins_per_phone, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id)
       DO UPDATE SET max_daily_spins_per_phone = EXCLUDED.max_daily_spins_per_phone,
                     updated_at = NOW()
       RETURNING max_daily_spins_per_phone, updated_at`,
      [maxDailySpins]
    );

    res.json(normalizeWheelSettingsRow(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

async function createWheelPrize(req, res, next) {
  try {
    const validation = validatePrizePayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { name, description, color, totalQuantity, remainingQuantity, sortOrder, isActive } = validation.value;
    const result = await pool.query(
      `INSERT INTO wheel_prizes (name, description, total_quantity, remaining_quantity, color, is_active, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, name, description, total_quantity, remaining_quantity, color, is_active, sort_order, created_at, updated_at`,
      [name, description, totalQuantity, remainingQuantity, color, isActive, sortOrder]
    );

    res.status(201).json(normalizePrizeRow(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

async function updateWheelPrize(req, res, next) {
  try {
    const prizeId = Number(req.params.id);
    if (!Number.isInteger(prizeId) || prizeId <= 0) {
      return res.status(400).json({ error: 'Giải thưởng không hợp lệ.' });
    }

    const validation = validatePrizePayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { name, description, color, totalQuantity, remainingQuantity, sortOrder, isActive } = validation.value;
    const result = await pool.query(
      `UPDATE wheel_prizes
       SET name = $1,
           description = $2,
           total_quantity = $3,
           remaining_quantity = $4,
           color = $5,
           is_active = $6,
           sort_order = $7,
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, description, total_quantity, remaining_quantity, color, is_active, sort_order, created_at, updated_at`,
      [name, description, totalQuantity, remainingQuantity, color, isActive, sortOrder, prizeId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy giải thưởng.' });
    }

    res.json(normalizePrizeRow(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

async function deleteWheelPrize(req, res, next) {
  try {
    const prizeId = Number(req.params.id);
    if (!Number.isInteger(prizeId) || prizeId <= 0) {
      return res.status(400).json({ error: 'Giải thưởng không hợp lệ.' });
    }

    const result = await pool.query('DELETE FROM wheel_prizes WHERE id = $1 RETURNING id', [prizeId]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy giải thưởng.' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function listWheelSpins(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, prize_id, prize_name, prize_description, prize_color, phone, spin_date, created_at
       FROM wheel_spins
       ORDER BY created_at DESC, id DESC
       LIMIT 100`
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDefaultAccount,
  upsertDefaultAccount,
  changePassword,
  listAppointments,
  getAvailabilitySettings,
  updateAvailabilitySettings,
  getWheelSettings,
  updateWheelSettings,
  listWheelPrizes,
  createWheelPrize,
  updateWheelPrize,
  deleteWheelPrize,
  listWheelSpins,
};
