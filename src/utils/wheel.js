const crypto = require('crypto');

function normalizePrizeRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    total_quantity: Number(row.total_quantity || 0),
    remaining_quantity: Number(row.remaining_quantity || 0),
    color: row.color || '#005eb8',
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isValidHexColor(value) {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(String(value || '').trim());
}

function pickWeightedPrize(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + prize.remaining_quantity, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let threshold = Math.floor(Math.random() * totalWeight) + 1;

  for (const prize of prizes) {
    threshold -= prize.remaining_quantity;
    if (threshold <= 0) {
      return prize;
    }
  }

  return prizes[prizes.length - 1] || null;
}

function normalizeWheelSettingsRow(row) {
  return {
    max_daily_spins_per_phone: Number(row.max_daily_spins_per_phone || 1),
    updated_at: row.updated_at,
  };
}

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function isValidPhone(phone) {
  return /^[0-9+()\s.-]{8,20}$/.test(normalizePhone(phone));
}

function generateClaimToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashClaimToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function buildClaimQrPayload(token) {
  return `ANVY_CLAIM:${token}`;
}

function parseClaimQrPayload(payload) {
  const value = String(payload || '').trim();
  if (!value) return '';
  if (value.startsWith('ANVY_CLAIM:')) {
    return value.slice('ANVY_CLAIM:'.length).trim();
  }
  return value;
}

function normalizeClaimRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    spin_id: Number(row.spin_id),
    prize_id: row.prize_id != null ? Number(row.prize_id) : null,
    phone: row.phone,
    prize_name: row.prize_name,
    prize_description: row.prize_description || '',
    prize_color: row.prize_color || '#005eb8',
    status: row.status,
    issued_at: row.issued_at,
    redeemed_at: row.redeemed_at,
    redeemed_by: row.redeemed_by != null ? Number(row.redeemed_by) : null,
    redeemed_by_username: row.redeemed_by_username || null,
  };
}

module.exports = {
  normalizePrizeRow,
  isValidHexColor,
  pickWeightedPrize,
  normalizeWheelSettingsRow,
  normalizePhone,
  isValidPhone,
  generateClaimToken,
  hashClaimToken,
  buildClaimQrPayload,
  parseClaimQrPayload,
  normalizeClaimRow,
};
