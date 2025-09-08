const express = require('express');
const userController = require('../controllers/userController');
const authGuard = require('../services/authGuard');
const router = express.Router();

router.post('/addUser', userController.register);
router.post('/login', userController.postLogin);
router.post("/logout", authGuard, userController.logout);

router.get('/user/profile', authGuard, userController.getProfile);
router.put('/user/profile', authGuard, userController.updateProfile);
router.post('/user/avatar', authGuard, userController.uploadAvatar);
router.get('/user/completion', authGuard, userController.getCompletion);
router.get('/user/companies', authGuard, userController.getCompanies);
module.exports = router;