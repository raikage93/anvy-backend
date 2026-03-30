const pool = require('../config/db');
const { isAppointmentWithinAvailability, normalizeAvailabilityRow } = require('../utils/availability');

async function getDefaultAccount(req, res, next) {
  try {
    const result = await pool.query('SELECT bank_bin, bank_name, bank_logo, account_no, description FROM default_accounts ORDER BY id DESC LIMIT 1');
    if (!result.rows[0]) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function createAppointment(req, res, next) {
  try {
    const { phone, appointment_time, notes } = req.body;

    if (!phone || !appointment_time) {
      return res.status(400).json({ error: 'Vui lòng nhập số điện thoại và thời gian khám.' });
    }

    const normalizedPhone = String(phone).trim();
    const normalizedNotes = String(notes || '').trim();
    const parsedTime = new Date(appointment_time);

    if (!/^[0-9+()\s.-]{8,20}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    if (Number.isNaN(parsedTime.getTime())) {
      return res.status(400).json({ error: 'Thời gian khám không hợp lệ.' });
    }

    if (parsedTime.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Vui lòng chọn một thời điểm trong tương lai.' });
    }

    const availabilityResult = await pool.query(
      `SELECT weekday, label, enabled, start_time, end_time
       FROM availability_settings
       WHERE enabled = TRUE`
    );

    const availability = availabilityResult.rows.map(normalizeAvailabilityRow);
    const matchedSetting = availability.find((setting) => isAppointmentWithinAvailability(parsedTime, setting));

    if (!matchedSetting) {
      return res.status(400).json({ error: 'Thời gian bạn chọn hiện không nằm trong lịch làm việc của phòng khám.' });
    }

    const result = await pool.query(
      `INSERT INTO appointments (phone, appointment_time, notes)
       VALUES ($1, $2, $3)
       RETURNING id, phone, appointment_time, notes, status, created_at`,
      [normalizedPhone, parsedTime.toISOString(), normalizedNotes]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function getAvailability(req, res, next) {
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

module.exports = { getDefaultAccount, createAppointment, getAvailability };
