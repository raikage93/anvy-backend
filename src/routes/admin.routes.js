const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getDefaultAccount, upsertDefaultAccount, changePassword } = require('../controllers/admin.controller');

router.use(authenticate, requireAdmin);

router.get('/default-account', getDefaultAccount);
router.put('/default-account', upsertDefaultAccount);
router.patch('/change-password', changePassword);

module.exports = router;
