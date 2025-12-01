const crypto = require('crypto');

let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (error) {
  throw error;
}

// Validation stricte des secrets JWT - pas de fallback
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const EMAIL_SECRET = process.env.JWT_EMAIL_SECRET;

if (!ACCESS_SECRET || !ACCESS_SECRET.trim()) {
  throw new Error('JWT_ACCESS_SECRET doit être défini dans les variables d\'environnement');
}

if (!EMAIL_SECRET || !EMAIL_SECRET.trim()) {
  throw new Error('JWT_EMAIL_SECRET doit être défini dans les variables d\'environnement');
}

if (ACCESS_SECRET === EMAIL_SECRET) {
  throw new Error('JWT_ACCESS_SECRET et JWT_EMAIL_SECRET doivent être différents pour des raisons de sécurité');
}

const generateAccessToken = (userId, options = {}) => {
  if (!userId) throw new Error('generateAccessToken requires a userId');
  return jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '15m', ...options });
};

const verifyAccessToken = (token, options = {}) => jwt.verify(token, ACCESS_SECRET, options);

const signEmailToken = (payload, options = {}) =>
  jwt.sign(payload, EMAIL_SECRET, { expiresIn: '24h', ...options });

const verifyEmailToken = (token, options = {}) => jwt.verify(token, EMAIL_SECRET, options);

const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

const hashRefreshToken = (token) => {
  if (!token) throw new Error('hashRefreshToken requires a token');
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  signEmailToken,
  verifyEmailToken,
  generateRefreshToken,
  hashRefreshToken
};
