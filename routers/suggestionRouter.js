const express = require('express');
const suggestionController = require('../controllers/suggestionController');
const authGuard = require('../services/authGuard');

const router = express.Router();

router.use(authGuard);

router.get('/', suggestionController.getSuggestions);
router.get('/stats', suggestionController.getSuggestionStats);
router.get('/filters', suggestionController.getSuggestionFilters);

router.post('/:id/ignore', suggestionController.ignoreSuggestion);
router.post('/:id/save', suggestionController.saveSuggestion);
router.post('/:id/contact', suggestionController.contactSuggestion);

module.exports = router;
