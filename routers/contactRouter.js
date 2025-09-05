const express = require('express');
let contactController;

try {
	contactController = require('../controllers/contactController');
} catch (e) {
	// Fallback controller if the real one is missing
	contactController = {
		postContact: (req, res) => res.status(501).json({ error: 'Contact controller not implemented' })
	};
}

const router = express.Router();

// Route POST pour le formulaire de contact
router.post('/', contactController.postContact);

module.exports = router;
