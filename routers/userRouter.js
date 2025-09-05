const express = require('express');
const userController = require('../controllers/userController');
const authGuard = require('../services/authGuard');
const router = express.Router();

router.post('/addUser', userController.register);
router.post('/login', userController.postLogin);
router.post("/logout", authGuard, userController.logout);
module.exports = router;