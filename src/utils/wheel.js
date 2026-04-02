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

module.exports = {
  normalizePrizeRow,
  isValidHexColor,
  pickWeightedPrize,
  normalizeWheelSettingsRow,
  normalizePhone,
  isValidPhone,
};
