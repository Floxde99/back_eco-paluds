const express = require('express');
const authGuard = require('../services/authGuard');
const adminGuard = require('../services/adminGuard');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.use(authGuard);
router.use(adminGuard);

router.get('/dashboard/metrics', adminController.getDashboardMetrics);

router.get('/companies/export', adminController.exportCompanies);
router.get('/companies', adminController.listCompanies);
router.get('/companies/:companyId', adminController.getCompanyDetail);
router.post('/companies', adminController.createCompany);
router.patch('/companies/:companyId/status', adminController.updateCompanyStatus);
router.patch('/companies/:companyId', adminController.updateCompany);
router.delete('/companies/:companyId', adminController.deleteCompany);

router.get('/moderation/pending', adminController.getPendingModeration);
router.get('/system-stats', adminController.getSystemStats);

module.exports = router;

