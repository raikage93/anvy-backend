const router = require('express').Router();
const { runFollowUpReminders } = require('../controllers/internal.controller');

router.post('/follow-up-reminders/run', runFollowUpReminders);

module.exports = router;
