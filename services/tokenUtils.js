const jwt = require('jsonwebtoken');

const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
};

const generateRefreshToken = () => {
  return require('crypto').randomBytes(64).toString('hex');
};

module.exports = { generateAccessToken, generateRefreshToken };
