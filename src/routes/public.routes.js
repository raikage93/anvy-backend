const router = require('express').Router();
const { getDefaultAccount, createAppointment, getAvailability } = require('../controllers/public.controller');

router.get('/default-account', getDefaultAccount);
router.get('/availability', getAvailability);
router.post('/appointments', createAppointment);

module.exports = router;
