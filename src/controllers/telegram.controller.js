const {
  acknowledgeReminder,
  answerCallbackQuery,
  clearInlineKeyboard,
  getReminderById,
} = require('../services/followUpReminder.service');

function getTelegramSecret(req) {
  return req.headers['x-telegram-bot-api-secret-token'] || '';
}

function verifyTelegramWebhook(req, res) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) return true;
  if (String(getTelegramSecret(req)) === String(configuredSecret)) return true;
  res.status(401).json({ error: 'Telegram webhook secret không hợp lệ.' });
  return false;
}

function parseAckCallback(data) {
  const match = String(data || '').match(/^followup_ack:(\d+):([a-f0-9]+)$/i);
  if (!match) return null;
  return {
    reminderId: Number(match[1]),
    ackToken: match[2],
  };
}

async function handleTelegramWebhook(req, res, next) {
  try {
    if (!verifyTelegramWebhook(req, res)) return;

    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery?.data) {
      return res.json({ ok: true });
    }

    const parsed = parseAckCallback(callbackQuery.data);
    if (!parsed) {
      try {
        await answerCallbackQuery(callbackQuery.id, 'Du lieu callback khong hop le.');
      } catch (error) {
        console.warn('Telegram callback answer failed:', error.message);
      }
      return res.json({ ok: true });
    }

    const actor =
      callbackQuery.from?.username
        ? `@${callbackQuery.from.username}`
        : callbackQuery.from?.id
          ? String(callbackQuery.from.id)
          : 'telegram-admin';

    const existingReminder = await getReminderById(parsed.reminderId);
    if (!existingReminder) {
      try {
        await answerCallbackQuery(callbackQuery.id, 'Khong tim thay nhac hen nay.');
      } catch (error) {
        console.warn('Telegram callback answer failed:', error.message);
      }
      return res.json({ ok: true });
    }

    if (existingReminder.status === 'acknowledged') {
      try {
        await clearInlineKeyboard(existingReminder.telegram_chat_id, existingReminder.telegram_message_id);
        await answerCallbackQuery(callbackQuery.id, 'Thong bao nay da duoc xac nhan truoc do.');
      } catch (error) {
        console.warn('Telegram callback finalize failed:', error.message);
      }
      return res.json({ ok: true });
    }

    const updated = await acknowledgeReminder({
      reminderId: parsed.reminderId,
      ackToken: parsed.ackToken,
      actor,
    });

    if (!updated) {
      try {
        await answerCallbackQuery(callbackQuery.id, 'Khong the xac nhan thong bao nay.');
      } catch (error) {
        console.warn('Telegram callback answer failed:', error.message);
      }
      return res.json({ ok: true });
    }

    try {
      await clearInlineKeyboard(updated.telegram_chat_id, updated.telegram_message_id);
      await answerCallbackQuery(callbackQuery.id, 'Da xac nhan. He thong se ngung nhac.');
    } catch (error) {
      console.warn('Telegram callback finalize failed:', error.message);
    }
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  handleTelegramWebhook,
};
