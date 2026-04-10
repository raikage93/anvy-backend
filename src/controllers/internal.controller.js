const { runFollowUpReminderJob } = require('../services/followUpReminder.service');

function getCronSecret(req) {
  return req.headers['x-cron-secret'] || req.headers['x-internal-secret'] || '';
}

async function runFollowUpReminders(req, res, next) {
  try {
    const configuredSecret = process.env.CRON_SECRET;
    if (!configuredSecret) {
      return res.status(500).json({ error: 'CRON_SECRET chưa được cấu hình trên backend.' });
    }

    if (String(getCronSecret(req)) !== String(configuredSecret)) {
      return res.status(401).json({ error: 'Cron secret không hợp lệ.' });
    }

    const daysBefore = req.query.days_before ?? req.body?.days_before ?? 3;
    const dryRun = String(req.query.dry_run ?? req.body?.dry_run ?? 'false') === 'true';
    const summary = await runFollowUpReminderJob({ daysBefore, dryRun });
    res.json(summary);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  runFollowUpReminders,
};
