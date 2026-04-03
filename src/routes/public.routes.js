const router = require('express').Router();
const {
  getDefaultAccount,
  createAppointment,
  getAvailability,
  getWheelPrizes,
  getWheelSettings,
  getRecentRedeemedWinners,
  spinWheel,
} = require('../controllers/public.controller');

router.get('/default-account', getDefaultAccount);
router.get('/availability', getAvailability);
router.get('/wheel/prizes', getWheelPrizes);
router.get('/wheel/settings', getWheelSettings);
router.get('/wheel/recent-winners', getRecentRedeemedWinners);
router.post('/wheel/spin', spinWheel);
router.post('/appointments', createAppointment);

module.exports = router;
