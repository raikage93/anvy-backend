const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
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
  listEyewearProducts,
  createEyewearProduct,
  updateEyewearProduct,
  deleteEyewearProduct,
  reindexEyewearProducts,
  verifyWheelClaim,
  redeemWheelClaim,
  listPatientRecords,
  getPatientRecord,
  createPatientRecord,
  updatePatientRecord,
  createPatientExamResult,
  updatePatientExamResult,
  deletePatientExamResult,
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
router.post('/wheel-claims/verify', verifyWheelClaim);
router.post('/wheel-claims/redeem', redeemWheelClaim);
router.get('/eyewear-products', listEyewearProducts);
router.post('/eyewear-products', imageUpload.single('image'), createEyewearProduct);
router.put('/eyewear-products/:id', imageUpload.single('image'), updateEyewearProduct);
router.delete('/eyewear-products/:id', deleteEyewearProduct);
router.post('/eyewear-products/reindex', reindexEyewearProducts);
router.get('/patient-records', listPatientRecords);
router.get('/patient-records/:id', getPatientRecord);
router.post('/patient-records', createPatientRecord);
router.put('/patient-records/:id', updatePatientRecord);
router.post('/patient-records/:id/results', createPatientExamResult);
router.put('/patient-records/:id/results/:resultId', updatePatientExamResult);
router.delete('/patient-records/:id/results/:resultId', deletePatientExamResult);
router.patch('/change-password', changePassword);

module.exports = router;
