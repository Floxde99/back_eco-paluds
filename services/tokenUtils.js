try {
  var jwt = require('jsonwebtoken');
  console.log('✅ JWT loaded successfully');
} catch (error) {
  console.error('❌ JWT load error:', error.message);
}

const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
};

const generateRefreshToken = () => {
  return require('crypto').randomBytes(64).toString('hex');
};

module.exports = { generateAccessToken, generateRefreshToken };
