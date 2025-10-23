const crypto = require('crypto');

let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (error) {
  throw error;
}

const resolveSecret = (primary, fallbackEnvKey) => {
  const primaryValue = primary && primary.trim();
  if (primaryValue) {
    return primaryValue;
  }

  const fallback = process.env[fallbackEnvKey];
  if (fallback && fallback.trim()) {
    
    return fallback.trim();
  }

  throw new Error(`Missing required JWT secret. Set ${fallbackEnvKey} or the dedicated secret in your environment.`);
};

const ACCESS_SECRET = resolveSecret(process.env.JWT_ACCESS_SECRET, 'JWT_SECRET');
const EMAIL_SECRET = resolveSecret(process.env.JWT_EMAIL_SECRET, 'JWT_SECRET');

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
