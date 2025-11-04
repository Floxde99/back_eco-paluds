const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'administrator']);

module.exports = async (req, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Utilisateur non authentifie' });
    }

    const user = await prisma.user.findUnique({
      where: { id_user: Number(userId) },
      select: {
        id_user: true,
        roleObj: { select: { name: true } }
      }
    });

    if (!user || !user.roleObj || !ADMIN_ROLES.has(String(user.roleObj.name || '').toLowerCase())) {
      return res.status(403).json({ error: 'Acces administrateur requis' });
    }

    res.locals.adminUser = user;
    return next();
  } catch (error) {
    console.error('? adminGuard:', error);
    return res.status(500).json({ error: 'Erreur de verification des droits administrateur' });
  }
};

