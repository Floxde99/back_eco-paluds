const {
  verifyAccessToken,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken
} = require('./tokenUtils');
const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const getValidatedUser = async (userId) => {
  if (!Number.isInteger(userId) || userId <= 0) {
    const err = new Error('Token invalide');
    err.status = 401;
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id_user: userId },
    select: { id_user: true, confirmEmail: true }
  });

  if (!user) {
    const err = new Error('Token invalide');
    err.status = 401;
    throw err;
  }

  if (!user.confirmEmail) {
    const err = new Error('Confirmation d\'email requise');
    err.status = 403;
    throw err;
  }

  return user;
};

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: 'En-tête d\'autorisation requis' });
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Format d\'autorisation invalide' });
  }

  try {
    const decoded = verifyAccessToken(token);

    if (!decoded || (typeof decoded.userId !== 'number' && typeof decoded.userId !== 'string')) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const user = await getValidatedUser(Number(decoded.userId));
    req.user = { userId: user.id_user };
    return next();
  } catch (err) {
    if (err.name !== 'TokenExpiredError') {
      const status = err.status || 401;
      return res.status(status).json({ error: err.message || 'Token invalide' });
    }

    const refreshTokenCookie = req.cookies?.refreshToken;
    if (!refreshTokenCookie) {
      return res.status(401).json({ error: 'Session expirée' });
    }

    try {
      const hashedToken = hashRefreshToken(refreshTokenCookie);
      const stored = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });

      if (!stored || stored.expiresAt < new Date()) {
        return res.status(401).json({ error: 'Session expirée' });
      }

      const user = await getValidatedUser(stored.userId);

      await prisma.refreshToken.delete({ where: { token: hashedToken } });

      const nextRefreshToken = generateRefreshToken();
      const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);

      await prisma.refreshToken.create({
        data: {
          token: nextRefreshTokenHash,
          userId: user.id_user,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
        }
      });

      res.cookie('refreshToken', nextRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        sameSite: 'strict',
        maxAge: REFRESH_TOKEN_TTL_MS
      });

      const newAccessToken = generateAccessToken(user.id_user);
      res.setHeader('x-access-token', newAccessToken);
      res.locals.newAccessToken = newAccessToken;

      req.user = { userId: user.id_user };
      return next();
    } catch (rotationErr) {
      console.error('Échec de la rotation du token de rafraîchissement dans authGuard :', rotationErr);
      return res.status(401).json({ error: 'Session expirée' });
    }
  }
};
