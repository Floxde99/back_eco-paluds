const express = require('express');
const router = express.Router();
const authGuard = require('../services/authGuard');
const companyContactController = require('../controllers/companyContactController');

router.use(authGuard);

router.get('/', companyContactController.getContacts);
router.post('/', companyContactController.createContact);
router.get('/messages/:conversationId', companyContactController.getMessages);
router.post('/messages', companyContactController.postMessage);
router.patch('/messages/:messageId/read', companyContactController.markMessageRead);
router.post('/conversations/:conversationId/mark-read', companyContactController.markConversationRead);

module.exports = router;
