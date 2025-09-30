const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();
const { verifyAccessToken } = require('./tokenUtils');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requis' });

  try {
    const decoded = verifyAccessToken(token);

    if (!decoded || (typeof decoded.userId !== 'number' && typeof decoded.userId !== 'string')) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const userId = Number(decoded.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    req.user = { ...decoded, userId };

    // Vérifier que l'utilisateur existe et que son email est confirmé
    const user = await prisma.user.findUnique({
      where: { id_user: userId },
      select: { confirmEmail: true, email: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    if (!user.confirmEmail) {
      return res.status(403).json({
        error: 'Email non confirmé',
        message: 'Veuillez confirmer votre email avant d\'accéder à cette ressource'
      });
    }

    next();
  } catch (err) {
    console.error('❌ Erreur authGuard:', err);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Token invalide' });
    }
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};
