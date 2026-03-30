const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  getDefaultAccount,
  upsertDefaultAccount,
  changePassword,
  listAppointments,
  getAvailabilitySettings,
  updateAvailabilitySettings,
} = require('../controllers/admin.controller');

router.use(authenticate, requireAdmin);

router.get('/default-account', getDefaultAccount);
router.put('/default-account', upsertDefaultAccount);
router.get('/availability', getAvailabilitySettings);
router.put('/availability', updateAvailabilitySettings);
router.get('/appointments', listAppointments);
router.patch('/change-password', changePassword);

module.exports = router;
