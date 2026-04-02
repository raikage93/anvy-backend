const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
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
} = require('../controllers/admin.controller');

router.use(authenticate, requireAdmin);

router.get('/default-account', getDefaultAccount);
router.put('/default-account', upsertDefaultAccount);
router.get('/availability', getAvailabilitySettings);
router.put('/availability', updateAvailabilitySettings);
router.get('/appointments', listAppointments);
router.get('/wheel-settings', getWheelSettings);
router.put('/wheel-settings', updateWheelSettings);
router.get('/wheel-prizes', listWheelPrizes);
router.post('/wheel-prizes', createWheelPrize);
router.put('/wheel-prizes/:id', updateWheelPrize);
router.delete('/wheel-prizes/:id', deleteWheelPrize);
router.get('/wheel-spins', listWheelSpins);
router.patch('/change-password', changePassword);

module.exports = router;
