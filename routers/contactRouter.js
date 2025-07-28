const express = require('express');
const contactController = require('../controllers/contactController');
const router = express.Router();

// Route POST pour le formulaire de contact
// Accessible via POST /contact (car le routeur est monté sur /contact dans server.js)
router.post('/', contactController.postContact);

module.exports = router;