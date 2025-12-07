const express = require('express');
const billingController = require('../controllers/billingController');
const authGuard = require('../services/authGuard');

const router = express.Router();

router.use(authGuard);

router.get('/plans', billingController.getPlans);
router.get('/subscription', billingController.getSubscription);
router.post('/payment-intents', billingController.createPaymentIntent);
router.post('/paypal/session', billingController.createPaypalSession);
router.post('/confirm-payment', billingController.confirmPayment);

module.exports = router;
