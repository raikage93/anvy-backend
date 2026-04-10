const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { normalizeAvailabilityRow, timeToMinutes } = require('../utils/availability');
const {
  normalizePrizeRow,
  isValidHexColor,
  normalizeWheelSettingsRow,
  parseClaimQrPayload,
  hashClaimToken,
  normalizeClaimRow,
  buildClaimQrPayload,
} = require('../utils/wheel');
const {
  indexProduct: indexEyewearProductInSearch,
  removeProduct: removeEyewearProductFromSearch,
  bulkReindex: bulkReindexEyewearProductsInSearch,
} = require('../services/eyewearSearch.service');

async function findClaimByToken(clientOrPool, rawToken, options = {}) {
  const claimToken = parseClaimQrPayload(rawToken);
  if (!claimToken) {
    return null;
  }

  const tokenHash = hashClaimToken(claimToken);
  const lockClause = options.forUpdate ? 'FOR UPDATE OF wc' : '';
  const result = await clientOrPool.query(
    `SELECT wc.id, wc.spin_id, wc.prize_id, wc.phone, wc.prize_name, wc.prize_description, wc.prize_color,
            wc.status, wc.issued_at, wc.redeemed_at, wc.redeemed_by, u.username AS redeemed_by_username
     FROM wheel_claims wc
     LEFT JOIN users u ON u.id = wc.redeemed_by
     WHERE wc.claim_token_hash = $1
     ${lockClause}`,
    [tokenHash]
  );

  if (!result.rows[0]) {
    return null;
  }

  return {
    token: claimToken,
    claim: normalizeClaimRow(result.rows[0]),
  };
}

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

function normalizeEyewearProductRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    brand: row.brand || 'Khác',
    frame_type: row.frame_type || 'Khác',
    price: Number(row.price || 0),
    description: row.description || '',
    image_url: row.image_url,
    quantity: Number(row.quantity || 0),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateEyewearPayload(body, options = {}) {
  const { imageUrlRequired = true } = options;
  const name = String(body.name || '').trim();
  const brand = String(body.brand || '').trim();
  const frameType = String(body.frame_type || '').trim();
  const price = Number(body.price);
  const description = String(body.description || '').trim();
  const imageUrl = String(body.image_url || '').trim();
  const quantity = Number(body.quantity);
  const sortOrder = Number(body.sort_order || 0);
  const isActive = String(body.is_active).toLowerCase() !== 'false';

  if (!name) {
    return { error: 'Vui lòng nhập tên sản phẩm.' };
  }

  if (!brand) {
    return { error: 'Vui lòng nhập brand.' };
  }

  if (!frameType) {
    return { error: 'Vui lòng nhập loại gọng.' };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Giá sản phẩm không hợp lệ.' };
  }

  if (imageUrlRequired && !imageUrl) {
    return { error: 'Vui lòng nhập ảnh sản phẩm.' };
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: 'Số lượng phải là số nguyên không âm.' };
  }

  if (!Number.isInteger(sortOrder)) {
    return { error: 'Thứ tự hiển thị không hợp lệ.' };
  }

  return {
    value: {
      name,
      brand,
      frameType,
      price,
      description,
      imageUrl,
      quantity,
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

async function listEyewearProducts(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, name, brand, frame_type, price, description, image_url, quantity, is_active, sort_order, created_at, updated_at
       FROM eyewear_products
       ORDER BY is_active DESC, sort_order ASC, id ASC`
    );

    res.json(result.rows.map(normalizeEyewearProductRow));
  } catch (err) {
    next(err);
  }
}

async function createEyewearProduct(req, res, next) {
  try {
    const imageUrl = req.file ? `/api/uploads/${req.file.filename}` : String(req.body.image_url || '').trim();
    const validation = validateEyewearPayload(
      {
        ...req.body,
        image_url: imageUrl,
      },
      { imageUrlRequired: true }
    );
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { name, brand, frameType, price, description, imageUrl: savedImageUrl, quantity, sortOrder, isActive } = validation.value;
    const result = await pool.query(
      `INSERT INTO eyewear_products (name, brand, frame_type, price, description, image_url, quantity, is_active, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, name, brand, frame_type, price, description, image_url, quantity, is_active, sort_order, created_at, updated_at`,
      [name, brand, frameType, price, description, savedImageUrl, quantity, isActive, sortOrder]
    );

    const product = normalizeEyewearProductRow(result.rows[0]);
    res.status(201).json(product);
    indexEyewearProductInSearch(product).catch((error) => {
      console.error('❌ Failed to sync eyewear product to Elasticsearch:', error.message);
    });
  } catch (err) {
    next(err);
  }
}

async function updateEyewearProduct(req, res, next) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Sản phẩm không hợp lệ.' });
    }

    const existingResult = await pool.query('SELECT image_url FROM eyewear_products WHERE id = $1', [productId]);
    if (!existingResult.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    const imageUrl = req.file
      ? `/api/uploads/${req.file.filename}`
      : String(req.body.image_url || existingResult.rows[0].image_url || '').trim();

    const validation = validateEyewearPayload(
      {
        ...req.body,
        image_url: imageUrl,
      },
      { imageUrlRequired: true }
    );
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { name, brand, frameType, price, description, imageUrl: savedImageUrl, quantity, sortOrder, isActive } = validation.value;
    const result = await pool.query(
      `UPDATE eyewear_products
       SET name = $1,
           brand = $2,
           frame_type = $3,
           price = $4,
           description = $5,
           image_url = $6,
           quantity = $7,
           is_active = $8,
           sort_order = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING id, name, brand, frame_type, price, description, image_url, quantity, is_active, sort_order, created_at, updated_at`,
      [name, brand, frameType, price, description, savedImageUrl, quantity, isActive, sortOrder, productId]
    );

    const product = normalizeEyewearProductRow(result.rows[0]);
    res.json(product);
    indexEyewearProductInSearch(product).catch((error) => {
      console.error('❌ Failed to sync eyewear product to Elasticsearch:', error.message);
    });
  } catch (err) {
    next(err);
  }
}

async function deleteEyewearProduct(req, res, next) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Sản phẩm không hợp lệ.' });
    }

    const result = await pool.query('DELETE FROM eyewear_products WHERE id = $1 RETURNING id', [productId]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    res.json({ success: true });
    removeEyewearProductFromSearch(productId).catch((error) => {
      console.error('❌ Failed to remove eyewear product from Elasticsearch:', error.message);
    });
  } catch (err) {
    next(err);
  }
}

async function reindexEyewearProducts(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, name, brand, frame_type, price, description, image_url, quantity, is_active, sort_order, created_at, updated_at
       FROM eyewear_products`
    );

    const products = result.rows.map(normalizeEyewearProductRow);
    await bulkReindexEyewearProductsInSearch(products);
    res.json({ success: true, total: products.length });
  } catch (err) {
    next(err);
  }
}

async function verifyWheelClaim(req, res, next) {
  try {
    const { token } = req.body;
    const found = await findClaimByToken(pool, token);

    if (!found) {
      return res.status(404).json({ error: 'QR không hợp lệ hoặc không tồn tại trong hệ thống.' });
    }

    res.json({
      claim: found.claim,
      qr_payload: buildClaimQrPayload(found.token),
    });
  } catch (err) {
    next(err);
  }
}

function normalizePatientProfileRow(row, results = undefined) {
  if (!row) return null;
  const value = {
    id: Number(row.id),
    full_name: row.full_name,
    birth_year: row.birth_year === null || row.birth_year === undefined ? null : Number(row.birth_year),
    phone: row.phone || '',
    phone_digits: row.phone_digits || '',
    address: row.address || '',
    latest_exam_date:
      row.latest_exam_date instanceof Date
        ? row.latest_exam_date.toISOString().slice(0, 10)
        : row.latest_exam_date
          ? String(row.latest_exam_date).slice(0, 10)
          : null,
    result_count: row.result_count === null || row.result_count === undefined ? 0 : Number(row.result_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  };

  if (results) {
    return { ...value, results };
  }

  return value;
}

function normalizePatientExamResultRow(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(row.id),
    patient_profile_id: Number(row.patient_profile_id),
    exam_date:
      row.exam_date instanceof Date
        ? row.exam_date.toISOString().slice(0, 10)
        : String(row.exam_date).slice(0, 10),
    quick_medical_assessment: row.quick_medical_assessment || '',
    va_unaided_mp: row.va_unaided_mp || '',
    va_unaided_mt: row.va_unaided_mt || '',
    va_unaided_binocular: row.va_unaided_binocular || '',
    va_old_mp: row.va_old_mp || '',
    va_old_mt: row.va_old_mt || '',
    va_old_binocular: row.va_old_binocular || '',
    va_new_mp: row.va_new_mp || '',
    va_new_mt: row.va_new_mt || '',
    va_new_binocular: row.va_new_binocular || '',
    sphere_old_mp: num(row.sphere_old_mp),
    cylinder_old_mp: num(row.cylinder_old_mp),
    axis_old_mp: row.axis_old_mp === null || row.axis_old_mp === undefined ? null : Number(row.axis_old_mp),
    sphere_old_mt: num(row.sphere_old_mt),
    cylinder_old_mt: num(row.cylinder_old_mt),
    axis_old_mt: row.axis_old_mt === null || row.axis_old_mt === undefined ? null : Number(row.axis_old_mt),
    sphere_new_mp: num(row.sphere_new_mp),
    cylinder_new_mp: num(row.cylinder_new_mp),
    axis_new_mp: row.axis_new_mp === null || row.axis_new_mp === undefined ? null : Number(row.axis_new_mp),
    sphere_new_mt: num(row.sphere_new_mt),
    cylinder_new_mt: num(row.cylinder_new_mt),
    axis_new_mt: row.axis_new_mt === null || row.axis_new_mt === undefined ? null : Number(row.axis_new_mt),
    next_appointment_date:
      row.next_appointment_date instanceof Date
        ? row.next_appointment_date.toISOString().slice(0, 10)
        : row.next_appointment_date
          ? String(row.next_appointment_date).slice(0, 10)
          : null,
    clinical_diagnosis: row.clinical_diagnosis || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  };
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const n = parseInt(String(value), 10);
  return Number.isInteger(n) ? n : null;
}

function validatePatientProfilePayload(body) {
  const fullName = String(body.full_name || '').trim();
  const phone = String(body.phone || '').trim();
  const phoneDigits = normalizePhoneDigits(phone);

  if (!fullName) {
    return { error: 'Vui lòng nhập họ tên bệnh nhân.' };
  }

  if (phoneDigits.length < 8 || phoneDigits.length > 20) {
    return { error: 'Mỗi hồ sơ cần một số điện thoại hợp lệ và duy nhất.' };
  }

  const birthYear = parseOptionalInt(body.birth_year);
  if (birthYear !== null && (birthYear < 1900 || birthYear > 2100)) {
    return { error: 'Năm sinh không hợp lệ.' };
  }

  return {
    value: {
      full_name: fullName,
      birth_year: birthYear,
      phone,
      phone_digits: phoneDigits,
      address: String(body.address ?? '').trim(),
    },
  };
}

function validatePatientExamResultPayload(body) {
  const examDateRaw = String(body.exam_date || '').trim();
  const nextAppointmentDateRaw = String(body.next_appointment_date || '').trim();

  if (!examDateRaw) {
    return { error: 'Vui lòng nhập ngày khám.' };
  }

  const examDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDateRaw);
  if (!examDateMatch) {
    return { error: 'Ngày khám không hợp lệ (dùng định dạng YYYY-MM-DD).' };
  }

  let nextAppointmentDate = null;
  if (nextAppointmentDateRaw) {
    const nextMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nextAppointmentDateRaw);
    if (!nextMatch) {
      return { error: 'Ngày hẹn khám tiếp theo không hợp lệ (dùng định dạng YYYY-MM-DD).' };
    }
    nextAppointmentDate = nextAppointmentDateRaw;
  }

  const str = (k) => String(body[k] ?? '').trim();

  const axisKeys = [
    'axis_old_mp',
    'axis_old_mt',
    'axis_new_mp',
    'axis_new_mt',
  ];
  for (const key of axisKeys) {
    const ax = parseOptionalInt(body[key]);
    if (ax !== null && (ax < 0 || ax > 180)) {
      return { error: 'Trục (axis) phải từ 0 đến 180.' };
    }
  }

  return {
    value: {
      exam_date: examDateRaw,
      quick_medical_assessment: str('quick_medical_assessment'),
      va_unaided_mp: str('va_unaided_mp'),
      va_unaided_mt: str('va_unaided_mt'),
      va_unaided_binocular: str('va_unaided_binocular'),
      va_old_mp: str('va_old_mp'),
      va_old_mt: str('va_old_mt'),
      va_old_binocular: str('va_old_binocular'),
      va_new_mp: str('va_new_mp'),
      va_new_mt: str('va_new_mt'),
      va_new_binocular: str('va_new_binocular'),
      sphere_old_mp: parseOptionalNumber(body.sphere_old_mp),
      cylinder_old_mp: parseOptionalNumber(body.cylinder_old_mp),
      axis_old_mp: parseOptionalInt(body.axis_old_mp),
      sphere_old_mt: parseOptionalNumber(body.sphere_old_mt),
      cylinder_old_mt: parseOptionalNumber(body.cylinder_old_mt),
      axis_old_mt: parseOptionalInt(body.axis_old_mt),
      sphere_new_mp: parseOptionalNumber(body.sphere_new_mp),
      cylinder_new_mp: parseOptionalNumber(body.cylinder_new_mp),
      axis_new_mp: parseOptionalInt(body.axis_new_mp),
      sphere_new_mt: parseOptionalNumber(body.sphere_new_mt),
      cylinder_new_mt: parseOptionalNumber(body.cylinder_new_mt),
      axis_new_mt: parseOptionalInt(body.axis_new_mt),
      next_appointment_date: nextAppointmentDate,
      clinical_diagnosis: str('clinical_diagnosis'),
    },
  };
}

function validatePatientRecordPayload(body) {
  const profile = validatePatientProfilePayload(body);
  if (profile.error) return profile;

  const result = validatePatientExamResultPayload(body);
  if (result.error) return result;

  return {
    value: {
      ...profile.value,
      ...result.value,
    },
  };
}

async function getPatientProfileWithResults(profileId, client = pool) {
  const profileResult = await client.query(
    `SELECT p.*,
            MAX(r.exam_date) AS latest_exam_date,
            COUNT(r.id)::int AS result_count
     FROM patient_profiles p
     LEFT JOIN patient_exam_results r ON r.patient_profile_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [profileId]
  );

  if (!profileResult.rows[0]) {
    return null;
  }

  const resultsResult = await client.query(
    `SELECT *
     FROM patient_exam_results
     WHERE patient_profile_id = $1
     ORDER BY exam_date DESC, id DESC`,
    [profileId]
  );

  return normalizePatientProfileRow(
    profileResult.rows[0],
    resultsResult.rows.map(normalizePatientExamResultRow)
  );
}

async function listPatientRecords(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const phoneDigits = normalizePhoneDigits(q);
    const pattern = `%${q}%`;
    const phonePattern = `%${phoneDigits}%`;
    const values = q ? [pattern, phonePattern, q] : [];
    const whereClause = q
      ? `WHERE p.full_name ILIKE $1 OR p.phone ILIKE $1 OR p.phone_digits LIKE $2 OR CAST(p.id AS TEXT) = $3`
      : '';

    const result = await pool.query(
      `SELECT p.*,
              MAX(r.exam_date) AS latest_exam_date,
              COUNT(r.id)::int AS result_count
       FROM patient_profiles p
       LEFT JOIN patient_exam_results r ON r.patient_profile_id = p.id
       ${whereClause}
       GROUP BY p.id
       ORDER BY MAX(r.exam_date) DESC NULLS LAST, p.updated_at DESC, p.id DESC
       LIMIT 200`,
      values
    );

    res.json(result.rows.map((row) => normalizePatientProfileRow(row)));
  } catch (err) {
    next(err);
  }
}

async function getPatientRecord(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Hồ sơ không hợp lệ.' });
    }

    const profile = await getPatientProfileWithResults(id);
    if (!profile) {
      return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
    }

    res.json(profile);
  } catch (err) {
    next(err);
  }
}

async function createPatientRecord(req, res, next) {
  const client = await pool.connect();

  try {
    const validation = validatePatientRecordPayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const v = validation.value;

    await client.query('BEGIN');

    const profileResult = await client.query(
      `INSERT INTO patient_profiles (full_name, birth_year, phone, phone_digits, address, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (phone_digits) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         birth_year = EXCLUDED.birth_year,
         phone = EXCLUDED.phone,
         address = EXCLUDED.address,
         updated_at = NOW()
       RETURNING *`,
      [v.full_name, v.birth_year, v.phone, v.phone_digits, v.address, req.user.id]
    );

    const profileId = Number(profileResult.rows[0].id);
    await client.query(
      `INSERT INTO patient_exam_results (
        patient_profile_id, exam_date, quick_medical_assessment,
        va_unaided_mp, va_unaided_mt, va_unaided_binocular,
        va_old_mp, va_old_mt, va_old_binocular, va_new_mp, va_new_mt, va_new_binocular,
        sphere_old_mp, cylinder_old_mp, axis_old_mp, sphere_old_mt, cylinder_old_mt, axis_old_mt,
        sphere_new_mp, cylinder_new_mp, axis_new_mp, sphere_new_mt, cylinder_new_mt, axis_new_mt,
        next_appointment_date, clinical_diagnosis, created_by, updated_at
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27, NOW()
      )
      ON CONFLICT (patient_profile_id, exam_date) DO UPDATE SET
        quick_medical_assessment = EXCLUDED.quick_medical_assessment,
        va_unaided_mp = EXCLUDED.va_unaided_mp,
        va_unaided_mt = EXCLUDED.va_unaided_mt,
        va_unaided_binocular = EXCLUDED.va_unaided_binocular,
        va_old_mp = EXCLUDED.va_old_mp,
        va_old_mt = EXCLUDED.va_old_mt,
        va_old_binocular = EXCLUDED.va_old_binocular,
        va_new_mp = EXCLUDED.va_new_mp,
        va_new_mt = EXCLUDED.va_new_mt,
        va_new_binocular = EXCLUDED.va_new_binocular,
        sphere_old_mp = EXCLUDED.sphere_old_mp,
        cylinder_old_mp = EXCLUDED.cylinder_old_mp,
        axis_old_mp = EXCLUDED.axis_old_mp,
        sphere_old_mt = EXCLUDED.sphere_old_mt,
        cylinder_old_mt = EXCLUDED.cylinder_old_mt,
        axis_old_mt = EXCLUDED.axis_old_mt,
        sphere_new_mp = EXCLUDED.sphere_new_mp,
        cylinder_new_mp = EXCLUDED.cylinder_new_mp,
        axis_new_mp = EXCLUDED.axis_new_mp,
        sphere_new_mt = EXCLUDED.sphere_new_mt,
        cylinder_new_mt = EXCLUDED.cylinder_new_mt,
        axis_new_mt = EXCLUDED.axis_new_mt,
        next_appointment_date = EXCLUDED.next_appointment_date,
        clinical_diagnosis = EXCLUDED.clinical_diagnosis,
        updated_at = NOW()`,
      [
        profileId,
        v.exam_date,
        v.quick_medical_assessment,
        v.va_unaided_mp,
        v.va_unaided_mt,
        v.va_unaided_binocular,
        v.va_old_mp,
        v.va_old_mt,
        v.va_old_binocular,
        v.va_new_mp,
        v.va_new_mt,
        v.va_new_binocular,
        v.sphere_old_mp,
        v.cylinder_old_mp,
        v.axis_old_mp,
        v.sphere_old_mt,
        v.cylinder_old_mt,
        v.axis_old_mt,
        v.sphere_new_mp,
        v.cylinder_new_mp,
        v.axis_new_mp,
        v.sphere_new_mt,
        v.cylinder_new_mt,
        v.axis_new_mt,
        v.next_appointment_date,
        v.clinical_diagnosis,
        req.user.id,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(await getPatientProfileWithResults(profileId));
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function updatePatientRecord(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Hồ sơ không hợp lệ.' });
    }

    const validation = validatePatientProfilePayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const v = validation.value;
    const result = await pool.query(
      `UPDATE patient_profiles SET
        full_name = $1,
        birth_year = $2,
        phone = $3,
        phone_digits = $4,
        address = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [v.full_name, v.birth_year, v.phone, v.phone_digits, v.address, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
    }

    res.json(await getPatientProfileWithResults(id));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Số điện thoại này đã thuộc về một hồ sơ khác.' });
    }
    next(err);
  }
}

async function createPatientExamResult(req, res, next) {
  try {
    const profileId = Number(req.params.id);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      return res.status(400).json({ error: 'Hồ sơ không hợp lệ.' });
    }

    const validation = validatePatientExamResultPayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const v = validation.value;
    const result = await pool.query(
      `INSERT INTO patient_exam_results (
        patient_profile_id, exam_date, quick_medical_assessment,
        va_unaided_mp, va_unaided_mt, va_unaided_binocular,
        va_old_mp, va_old_mt, va_old_binocular, va_new_mp, va_new_mt, va_new_binocular,
        sphere_old_mp, cylinder_old_mp, axis_old_mp, sphere_old_mt, cylinder_old_mt, axis_old_mt,
        sphere_new_mp, cylinder_new_mp, axis_new_mp, sphere_new_mt, cylinder_new_mt, axis_new_mt,
        next_appointment_date, clinical_diagnosis, created_by, updated_at
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27, NOW()
      )
      RETURNING *`,
      [
        profileId,
        v.exam_date,
        v.quick_medical_assessment,
        v.va_unaided_mp,
        v.va_unaided_mt,
        v.va_unaided_binocular,
        v.va_old_mp,
        v.va_old_mt,
        v.va_old_binocular,
        v.va_new_mp,
        v.va_new_mt,
        v.va_new_binocular,
        v.sphere_old_mp,
        v.cylinder_old_mp,
        v.axis_old_mp,
        v.sphere_old_mt,
        v.cylinder_old_mt,
        v.axis_old_mt,
        v.sphere_new_mp,
        v.cylinder_new_mp,
        v.axis_new_mp,
        v.sphere_new_mt,
        v.cylinder_new_mt,
        v.axis_new_mt,
        v.next_appointment_date,
        v.clinical_diagnosis,
        req.user.id,
      ]
    );

    res.status(201).json(normalizePatientExamResultRow(result.rows[0]));
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ngày khám này đã có kết quả. Hãy sửa kết quả hiện có thay vì tạo mới.' });
    }
    next(err);
  }
}

async function updatePatientExamResult(req, res, next) {
  try {
    const profileId = Number(req.params.id);
    const resultId = Number(req.params.resultId);
    if (!Number.isInteger(profileId) || profileId <= 0 || !Number.isInteger(resultId) || resultId <= 0) {
      return res.status(400).json({ error: 'Kết quả khám không hợp lệ.' });
    }

    const validation = validatePatientExamResultPayload(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const v = validation.value;
    const result = await pool.query(
      `UPDATE patient_exam_results SET
        exam_date = $1,
        quick_medical_assessment = $2,
        va_unaided_mp = $3,
        va_unaided_mt = $4,
        va_unaided_binocular = $5,
        va_old_mp = $6,
        va_old_mt = $7,
        va_old_binocular = $8,
        va_new_mp = $9,
        va_new_mt = $10,
        va_new_binocular = $11,
        sphere_old_mp = $12,
        cylinder_old_mp = $13,
        axis_old_mp = $14,
        sphere_old_mt = $15,
        cylinder_old_mt = $16,
        axis_old_mt = $17,
        sphere_new_mp = $18,
        cylinder_new_mp = $19,
        axis_new_mp = $20,
        sphere_new_mt = $21,
        cylinder_new_mt = $22,
        axis_new_mt = $23,
        next_appointment_date = $24,
        clinical_diagnosis = $25,
        updated_at = NOW()
       WHERE id = $26 AND patient_profile_id = $27
       RETURNING *`,
      [
        v.exam_date,
        v.quick_medical_assessment,
        v.va_unaided_mp,
        v.va_unaided_mt,
        v.va_unaided_binocular,
        v.va_old_mp,
        v.va_old_mt,
        v.va_old_binocular,
        v.va_new_mp,
        v.va_new_mt,
        v.va_new_binocular,
        v.sphere_old_mp,
        v.cylinder_old_mp,
        v.axis_old_mp,
        v.sphere_old_mt,
        v.cylinder_old_mt,
        v.axis_old_mt,
        v.sphere_new_mp,
        v.cylinder_new_mp,
        v.axis_new_mp,
        v.sphere_new_mt,
        v.cylinder_new_mt,
        v.axis_new_mt,
        v.next_appointment_date,
        v.clinical_diagnosis,
        resultId,
        profileId,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy kết quả khám.' });
    }

    res.json(normalizePatientExamResultRow(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ngày khám này đã có kết quả khác trong hồ sơ.' });
    }
    next(err);
  }
}

async function deletePatientExamResult(req, res, next) {
  try {
    const profileId = Number(req.params.id);
    const resultId = Number(req.params.resultId);
    if (!Number.isInteger(profileId) || profileId <= 0 || !Number.isInteger(resultId) || resultId <= 0) {
      return res.status(400).json({ error: 'Kết quả khám không hợp lệ.' });
    }

    const result = await pool.query(
      `DELETE FROM patient_exam_results
       WHERE id = $1 AND patient_profile_id = $2
       RETURNING id`,
      [resultId, profileId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Không tìm thấy kết quả khám.' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function redeemWheelClaim(req, res, next) {
  const client = await pool.connect();

  try {
    const { token } = req.body;
    await client.query('BEGIN');

    const found = await findClaimByToken(client, token, { forUpdate: true });
    if (!found) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'QR không hợp lệ hoặc không tồn tại trong hệ thống.' });
    }

    if (found.claim.status === 'redeemed') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Mã QR này đã được xác nhận nhận quà trước đó.',
        claim: found.claim,
      });
    }

    const result = await client.query(
      `UPDATE wheel_claims
       SET status = 'redeemed',
           redeemed_at = NOW(),
           redeemed_by = $1
       WHERE id = $2
       RETURNING id, spin_id, prize_id, phone, prize_name, prize_description, prize_color, status, issued_at, redeemed_at, redeemed_by`,
      [req.user.id, found.claim.id]
    );

    await client.query('COMMIT');

    res.json({
      claim: normalizeClaimRow({
        ...result.rows[0],
        redeemed_by_username: req.user.username,
      }),
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
  listEyewearProducts,
  createEyewearProduct,
  updateEyewearProduct,
  deleteEyewearProduct,
  reindexEyewearProducts,
  verifyWheelClaim,
  redeemWheelClaim,
  listPatientRecords,
  getPatientRecord,
  createPatientRecord,
  updatePatientRecord,
  createPatientExamResult,
  updatePatientExamResult,
  deletePatientExamResult,
};
