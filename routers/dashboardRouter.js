const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const authGuard = require('../services/authGuard');
const router = express.Router();

router.get('/stats', authGuard, dashboardController.getStats);

module.exports = router;
