const express = require('express');
const rateLimit = require('express-rate-limit');
const authGuard = require('../services/authGuard');
const assistantController = require('../controllers/assistantController');
const { ipKeyGenerator } = require('express-rate-limit');

const router = express.Router();

const assistantLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req),
  message: 'Trop de requêtes, merci de patienter quelques instants.'
});

router.get('/templates', authGuard, assistantController.getTemplates);
router.get('/conversations', authGuard, assistantController.listConversations);
router.post('/conversations', authGuard, assistantLimiter, assistantController.createConversation);
router.get('/conversations/:id/messages', authGuard, assistantController.getMessages);
router.get('/conversations/:id/updates', authGuard, assistantController.getUpdates);
router.post('/messages', authGuard, assistantLimiter, assistantController.postMessage);
router.post('/escalations', authGuard, assistantLimiter, assistantController.createEscalation);

module.exports = router;
