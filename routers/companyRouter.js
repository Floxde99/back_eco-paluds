const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const authGuard = require('../services/authGuard');
const rateLimit = require('express-rate-limit');

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de requêtes de recherche, veuillez réessayer dans un instant.'
  }
});

// Middleware d'authentification pour toutes les routes
router.use(authGuard);

// ===================
// DIRECTORY SEARCH & DETAIL
// ===================

router.get('/companies/filters', searchLimiter, companyController.getCompanyFilters);

router.get('/companies', searchLimiter, companyController.searchCompanies);
router.get('/companies/:companyId', companyController.getCompanyDetail);

// ===================
// COMPANY CREATION & PROFILE
// ===================

router.post('/', companyController.createCompany);

router.get('/profile', companyController.getCompanyProfile);

router.put('/general', companyController.updateCompanyGeneral);

// ===================
// PRODUCTIONS
// ===================

router.get('/productions', companyController.getProductions);

router.post('/productions', companyController.addProduction);

router.put('/productions/:id', companyController.updateProduction);

router.delete('/productions/:id', companyController.deleteProduction);

// ===================
// BESOINS
// ===================

router.get('/besoins', companyController.getBesoins);

router.post('/besoins', companyController.addBesoin);

router.put('/besoins/:id', companyController.updateBesoin);

router.delete('/besoins/:id', companyController.deleteBesoin);

// ===================
// DECHETS
// ===================

router.get('/dechets', companyController.getDechets);

router.post('/dechets', companyController.addDechet);

router.put('/dechets/:id', companyController.updateDechet);

router.delete('/dechets/:id', companyController.deleteDechet);

// ===================
// GEOLOCATION
// ===================

router.get('/geolocation', companyController.getGeolocation);

router.put('/geolocation', companyController.updateGeolocation);

router.get('/:companyId', companyController.getCompanyDetail);

module.exports = router;