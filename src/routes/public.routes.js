const router = require('express').Router();
const {
  getDefaultAccount,
  createAppointment,
  getAvailability,
  getWheelPrizes,
  getWheelSettings,
  getRecentRedeemedWinners,
  getMyWheelRewards,
  claimWheelPrize,
  spinWheel,
} = require('../controllers/public.controller');

router.get('/default-account', getDefaultAccount);
router.get('/availability', getAvailability);
router.get('/wheel/prizes', getWheelPrizes);
router.get('/wheel/settings', getWheelSettings);
router.get('/wheel/recent-winners', getRecentRedeemedWinners);
router.get('/wheel/my-rewards', getMyWheelRewards);
router.post('/wheel/claim', claimWheelPrize);
router.post('/wheel/spin', spinWheel);
router.post('/appointments', createAppointment);

module.exports = router;
