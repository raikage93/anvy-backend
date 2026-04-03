const pool = require('../config/db');
const { isAppointmentWithinAvailability, normalizeAvailabilityRow } = require('../utils/availability');
const {
  normalizePrizeRow,
  pickWeightedPrize,
  normalizeWheelSettingsRow,
  normalizePhone,
  isValidPhone,
  generateClaimToken,
  hashClaimToken,
  buildClaimQrPayload,
} = require('../utils/wheel');

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

async function getWheelPrizes(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, name, description, total_quantity, remaining_quantity, color, is_active, sort_order, created_at, updated_at
       FROM wheel_prizes
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC`
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

function maskPhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) {
    return '';
  }

  const visibleStart = raw.slice(0, 3);
  const visibleEnd = raw.slice(-3);
  const hiddenLength = Math.max(raw.length - 6, 0);

  return `${visibleStart}${'*'.repeat(hiddenLength)}${visibleEnd}`;
}

function buildPublicClaim(claimRow) {
  if (!claimRow) {
    return null;
  }

  return {
    id: Number(claimRow.id),
    spin_id: Number(claimRow.spin_id),
    prize_id: claimRow.prize_id != null ? Number(claimRow.prize_id) : null,
    phone: claimRow.phone,
    prize_name: claimRow.prize_name,
    prize_description: claimRow.prize_description || '',
    prize_color: claimRow.prize_color || '#005eb8',
    status: claimRow.status,
    issued_at: claimRow.issued_at,
    redeemed_at: claimRow.redeemed_at,
    redeemed_by: claimRow.redeemed_by != null ? Number(claimRow.redeemed_by) : null,
    redeemed_by_username: claimRow.redeemed_by_username || null,
    token: claimRow.claim_token || undefined,
    qr_payload: claimRow.claim_token ? buildClaimQrPayload(claimRow.claim_token) : undefined,
  };
}

async function getRecentRedeemedWinners(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, phone, prize_name, prize_color, redeemed_at
       FROM wheel_claims
       WHERE status = 'redeemed'
       ORDER BY redeemed_at DESC, id DESC
       LIMIT 12`
    );

    res.json(
      result.rows.map((row) => ({
        id: Number(row.id),
        phone: maskPhone(row.phone),
        prize_name: row.prize_name,
        prize_color: row.prize_color || '#005eb8',
        redeemed_at: row.redeemed_at,
      }))
    );
  } catch (err) {
    next(err);
  }
}

async function getMyWheelRewards(req, res, next) {
  try {
    const phone = normalizePhone(req.query.phone);

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    const todayResult = await pool.query(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS spin_date`
    );
    const spinDate = todayResult.rows[0].spin_date;

    const result = await pool.query(
      `SELECT ws.id, ws.prize_id, ws.prize_name, ws.prize_description, ws.prize_color, ws.phone, ws.spin_date, ws.created_at,
              wc.id AS claim_id, wc.status AS claim_status, wc.issued_at, wc.redeemed_at, wc.redeemed_by, wc.claim_token
       FROM wheel_spins ws
       LEFT JOIN wheel_claims wc ON wc.spin_id = ws.id
       WHERE ws.phone = $1 AND ws.spin_date = $2
       ORDER BY ws.created_at DESC, ws.id DESC`,
      [phone, spinDate]
    );

    res.json(
      result.rows.map((row) => ({
        id: Number(row.id),
        prize_id: row.prize_id != null ? Number(row.prize_id) : null,
        prize_name: row.prize_name,
        prize_description: row.prize_description || '',
        prize_color: row.prize_color || '#005eb8',
        phone: row.phone,
        spin_date: row.spin_date,
        created_at: row.created_at,
        claim: row.claim_id
          ? buildPublicClaim({
              id: row.claim_id,
              spin_id: row.id,
              prize_id: row.prize_id,
              phone: row.phone,
              prize_name: row.prize_name,
              prize_description: row.prize_description,
              prize_color: row.prize_color,
              status: row.claim_status,
              issued_at: row.issued_at,
              redeemed_at: row.redeemed_at,
              redeemed_by: row.redeemed_by,
              claim_token: row.claim_token,
            })
          : null,
      }))
    );
  } catch (err) {
    next(err);
  }
}

async function spinWheel(req, res, next) {
  const client = await pool.connect();

  try {
    const phone = normalizePhone(req.body.phone);

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Vui lòng nhập số điện thoại hợp lệ trước khi quay.' });
    }

    await client.query('BEGIN');

    const settingsResult = await client.query(
      `SELECT max_daily_spins_per_phone, updated_at
       FROM wheel_settings
       WHERE id = 1
       FOR UPDATE`
    );
    const wheelSettings = normalizeWheelSettingsRow(settingsResult.rows[0] || { max_daily_spins_per_phone: 1 });

    const todayResult = await client.query(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS spin_date`
    );
    const spinDate = todayResult.rows[0].spin_date;

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM wheel_spins
       WHERE phone = $1 AND spin_date = $2`,
      [phone, spinDate]
    );

    const spinsUsedToday = Number(countResult.rows[0]?.total || 0);
    if (spinsUsedToday >= wheelSettings.max_daily_spins_per_phone) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: `Số điện thoại này đã dùng hết ${wheelSettings.max_daily_spins_per_phone} lượt quay trong hôm nay.`,
        max_daily_spins_per_phone: wheelSettings.max_daily_spins_per_phone,
        spins_used_today: spinsUsedToday,
        spins_remaining_today: 0,
      });
    }

    const prizesResult = await client.query(
      `SELECT id, name, description, total_quantity, remaining_quantity, color, is_active, sort_order, created_at, updated_at
       FROM wheel_prizes
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC
       FOR UPDATE`
    );

    const prizes = prizesResult.rows.map(normalizePrizeRow);
    const availablePrizes = prizes.filter((prize) => prize.remaining_quantity > 0);

    if (availablePrizes.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vòng quay hiện đã hết phần quà. Vui lòng quay lại sau.' });
    }

    const selectedPrize = pickWeightedPrize(availablePrizes);
    const segmentIndex = prizes.findIndex((prize) => prize.id === selectedPrize.id);

    const updateResult = await client.query(
      `UPDATE wheel_prizes
       SET remaining_quantity = remaining_quantity - 1,
           updated_at = NOW()
       WHERE id = $1 AND remaining_quantity > 0
       RETURNING id, remaining_quantity`,
      [selectedPrize.id]
    );

    if (!updateResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Giải thưởng vừa được nhận bởi người khác. Vui lòng quay lại.' });
    }

    const spinResult = await client.query(
      `INSERT INTO wheel_spins (prize_id, prize_name, prize_description, prize_color, phone, spin_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, prize_id, prize_name, prize_description, prize_color, phone, spin_date, created_at`,
      [selectedPrize.id, selectedPrize.name, selectedPrize.description, selectedPrize.color, phone, spinDate]
    );

    await client.query('COMMIT');

    const updatedPrizes = prizes.map((prize) =>
      prize.id === selectedPrize.id
        ? { ...prize, remaining_quantity: Math.max(prize.remaining_quantity - 1, 0) }
        : prize
    );

    res.json({
      spin: {
        ...spinResult.rows[0],
        segment_index: segmentIndex,
      },
      prize: updatedPrizes[segmentIndex],
      prizes: updatedPrizes,
      max_daily_spins_per_phone: wheelSettings.max_daily_spins_per_phone,
      spins_used_today: spinsUsedToday + 1,
      spins_remaining_today: Math.max(wheelSettings.max_daily_spins_per_phone - spinsUsedToday - 1, 0),
      phone,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function claimWheelPrize(req, res, next) {
  const client = await pool.connect();

  try {
    const phone = normalizePhone(req.body.phone);
    const spinId = Number(req.body.spin_id);

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    if (!Number.isInteger(spinId) || spinId <= 0) {
      return res.status(400).json({ error: 'Lượt quay không hợp lệ.' });
    }

    await client.query('BEGIN');

    const todayResult = await client.query(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS spin_date`
    );
    const claimDate = todayResult.rows[0].spin_date;

    const existingForSpinResult = await client.query(
      `SELECT wc.id, wc.spin_id, wc.prize_id, wc.phone, wc.prize_name, wc.prize_description, wc.prize_color,
              wc.status, wc.issued_at, wc.redeemed_at, wc.redeemed_by, wc.claim_token
       FROM wheel_claims wc
       WHERE wc.spin_id = $1
       FOR UPDATE`,
      [spinId]
    );

    if (existingForSpinResult.rows[0]) {
      await client.query('COMMIT');
      return res.json({
        claim: buildPublicClaim(existingForSpinResult.rows[0]),
      });
    }

    const existingDailyClaimResult = await client.query(
      `SELECT wc.id, wc.spin_id, wc.prize_id, wc.phone, wc.prize_name, wc.prize_description, wc.prize_color,
              wc.status, wc.issued_at, wc.redeemed_at, wc.redeemed_by, wc.claim_token
       FROM wheel_claims wc
       WHERE wc.phone = $1 AND wc.claim_date = $2
       ORDER BY wc.issued_at DESC, wc.id DESC
       LIMIT 1
       FOR UPDATE`,
      [phone, claimDate]
    );

    if (existingDailyClaimResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Mỗi số điện thoại chỉ có thể nhận 1 giải mỗi ngày.',
        claim: buildPublicClaim(existingDailyClaimResult.rows[0]),
      });
    }

    const spinResult = await client.query(
      `SELECT id, prize_id, prize_name, prize_description, prize_color, phone, spin_date, created_at
       FROM wheel_spins
       WHERE id = $1 AND phone = $2
       FOR UPDATE`,
      [spinId, phone]
    );

    const spinRow = spinResult.rows[0];
    if (!spinRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy lượt quay tương ứng với số điện thoại này.' });
    }

    if (String(spinRow.spin_date) !== String(claimDate)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Chỉ có thể nhận giải từ các lượt quay trong ngày hôm nay.' });
    }

    const claimToken = generateClaimToken();
    const claimTokenHash = hashClaimToken(claimToken);
    const claimInsertResult = await client.query(
      `INSERT INTO wheel_claims (
          spin_id, prize_id, phone, prize_name, prize_description, prize_color, claim_token, claim_token_hash, claim_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, spin_id, prize_id, phone, prize_name, prize_description, prize_color, status, issued_at, redeemed_at, redeemed_by, claim_token`,
      [
        Number(spinRow.id),
        spinRow.prize_id,
        phone,
        spinRow.prize_name,
        spinRow.prize_description,
        spinRow.prize_color,
        claimToken,
        claimTokenHash,
        claimDate,
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      claim: buildPublicClaim(claimInsertResult.rows[0]),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  getDefaultAccount,
  createAppointment,
  getAvailability,
  getWheelPrizes,
  getWheelSettings,
  getRecentRedeemedWinners,
  getMyWheelRewards,
  claimWheelPrize,
  spinWheel,
};
