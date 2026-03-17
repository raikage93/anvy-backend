const router = require('express').Router();
const { getDefaultAccount } = require('../controllers/public.controller');

router.get('/default-account', getDefaultAccount);

module.exports = router;
