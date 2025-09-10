const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken'); // ← AJOUT DE L'IMPORT MANQUANT
const multer = require("multer");
const path = require("path");
const sharp = require('sharp');
const fsPromises = require('fs').promises;
const { z } = require('zod');
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../services/tokenUtils");
const { sendMail } = require('../services/mailer');

// Schémas de validation Zod pour la sécurité
const registerSchema = z.object({
  firstName: z.string().min(1).max(50).trim(),
  lastName: z.string().min(1).max(50).trim(),
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/), // Au moins 8 chars, maj, min, chiffre
  confirmPassword: z.string(),
  phone: z.string().optional(),
  role: z.string().optional(),
}).strip() // ← AJOUTER .strip() pour ignorer les champs inconnus comme "company"
.refine(data => data.password === data.confirmPassword, {
  message: "Les mots de passe ne correspondent pas",
  path: ["confirmPassword"],
});

exports.register = async (req, res) => {
  try {
    // Valider les données avec Zod
    const validatedData = registerSchema.parse(req.body);

    // Utiliser les données validées
    const { firstName, lastName, email, password, confirmPassword, phone, role } = validatedData;

    console.log("🔍 Données normalisées:", {
      firstName,
      lastName,
      email,
      phone,
      role,
      passwordLength: password?.length,
      confirmPasswordLength: confirmPassword?.length,
    });

    // SUPPRESSION des logs de mots de passe pour la sécurité
    // console.log("🔐 Validation mots de passe:", { ... });

    // Validation des champs requis
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        error: "Tous les champs obligatoires doivent être remplis",
        missing: {
          firstName: !firstName,
          lastName: !lastName,
          email: !email,
          password: !password,
          confirmPassword: !confirmPassword,
        },
        received: {
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          email: req.body.email,
          password: !!req.body.password,
          confirmPassword: !!req.body.confirmPassword,
        },
      });
    }

    // Trimmer les espaces invisibles (si pas déjà fait côté front)
    const cleanPassword = password.trim();
    const cleanConfirmPassword = confirmPassword.trim();

    // SUPPRESSION des logs de mots de passe pour la sécurité
    // console.log("🔐 Après trim:", { ... });

    if (cleanPassword !== cleanConfirmPassword) {
      return res.status(400).json({
        error: "Les mots de passe ne correspondent pas",
        // SUPPRESSION du debug avec les mots de passe
      });
    }

    // Vérifier si l'email existe déjà
    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Un utilisateur avec cet email existe déjà",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Resolve role name to roleId if possible (schema uses relation)
    let roleIdValue = null;
    if (role && typeof role === 'string') {
      const roleRecord = await prisma.role.findFirst({ where: { name: role.trim() } });
      if (roleRecord) roleIdValue = roleRecord.id_role;
    }

    const newUser = await prisma.user.create({
      data: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        phone: phone?.trim() || null,
        roleId: roleIdValue,
      },
      include: { roleObj: true }
    });

    console.log("✅ Utilisateur créé avec succès:", {
      id: newUser.id_user,
      email: newUser.email,
    });

    // Retourner une réponse JSON au lieu d'une redirection
    // Envoi d'un email de confirmation (non bloquant)
    (async () => {
      try {
        // Générer un token de confirmation (valide 24h)
        const confirmationToken = jwt.sign(
          { userId: newUser.id_user, email: newUser.email },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Créer le lien de confirmation (utilise maintenant POST)
        const confirmationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/confirm-email`;

        const subject = 'Confirmez votre email - Eco-Paluds';
        const text = `Bonjour ${newUser.first_name} ${newUser.last_name},

Bienvenue sur Eco-Paluds !

Pour finaliser votre inscription et accéder à votre compte, veuillez confirmer votre email en cliquant sur ce lien :
${confirmationLink}

Votre token de confirmation : ${confirmationToken}

Ce lien expirera dans 24 heures.

Si vous n'avez pas créé de compte sur Eco-Paluds, ignorez cet email.

Cordialement,
L'équipe Eco-Paluds`;

        const html = `
<p>Bonjour <strong>${newUser.first_name} ${newUser.last_name}</strong>,</p>

<p>Bienvenue sur <strong>Eco-Paluds</strong> !</p>

<p>Pour finaliser votre inscription et accéder à votre compte, veuillez confirmer votre email en cliquant sur le bouton ci-dessous :</p>

<p style="text-align: center; margin: 30px 0;">
  <a href="${confirmationLink}?token=${confirmationToken}"
     style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Confirmer mon email
  </a>
</p>

<p><small>Token de confirmation : ${confirmationToken}</small></p>
<p><small>Ce lien expirera dans 24 heures.</small></p>
<p><small>Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${confirmationLink}?token=${confirmationToken}</small></p>

<p>Si vous n'avez pas créé de compte sur Eco-Paluds, ignorez cet email.</p>

<p>Cordialement,<br>L'équipe Eco-Paluds</p>`;

        await sendMail(newUser.email, subject, text, html);
        console.log('✅ Email de confirmation envoyé à', newUser.email);
      } catch (mailErr) {
        console.error('❌ Échec envoi email confirmation:', mailErr);
      }
    })();

    return res.status(201).json({
      message: "Utilisateur créé avec succès",
      user: {
        id: newUser.id_user,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        email: newUser.email,
        roleId: newUser.roleId,
        role: newUser.roleObj?.name || null,
      },
    });
  } catch (error) {
    console.error("❌ Erreur lors de la création de l'utilisateur:", error);

    // Gestion d'erreurs spécifiques
    if (error.code === "P2002") {
      return res.status(409).json({
        error: "Un utilisateur avec cet email existe déjà",
      });
    }

    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

exports.confirmEmail = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: 'Token de confirmation manquant' });
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId || !decoded.email) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id_user: decoded.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier que l'email correspond
    if (user.email !== decoded.email) {
      return res.status(400).json({ error: 'Token ne correspond pas à l\'email' });
    }

    // Vérifier si l'email est déjà confirmé
    if (user.confirmEmail) {
      return res.status(200).json({
        message: 'Email déjà confirmé',
        user: {
          id: user.id_user,
          email: user.email,
          confirmEmail: user.confirmEmail
        }
      });
    }

    // Mettre à jour confirmEmail à true
    const updatedUser = await prisma.user.update({
      where: { id_user: decoded.userId },
      data: { confirmEmail: true },
      select: {
        id_user: true,
        first_name: true,
        last_name: true,
        email: true,
        confirmEmail: true
      }
    });

    console.log('✅ Email confirmé pour utilisateur:', updatedUser.email);

    return res.status(200).json({
      message: 'Email confirmé avec succès ! Vous pouvez maintenant vous connecter.',
      user: {
        id: updatedUser.id_user,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        email: updatedUser.email,
        confirmEmail: updatedUser.confirmEmail
      }
    });
  } catch (error) {
    console.error('❌ Erreur confirmation email:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({
        error: 'Token expiré',
        message: 'Le lien de confirmation a expiré. Veuillez vous réinscrire.'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({
        error: 'Token invalide',
        message: 'Le lien de confirmation est invalide.'
      });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.confirmEmailPost = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token de confirmation manquant' });
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId || !decoded.email) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id_user: decoded.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Vérifier que l'email correspond
    if (user.email !== decoded.email) {
      return res.status(400).json({ error: 'Token ne correspond pas à l\'email' });
    }

    // Vérifier si l'email est déjà confirmé
    if (user.confirmEmail) {
      return res.status(200).json({
        message: 'Email déjà confirmé',
        user: {
          id: user.id_user,
          email: user.email,
          confirmEmail: user.confirmEmail
        }
      });
    }

    // Mettre à jour confirmEmail à true
    const updatedUser = await prisma.user.update({
      where: { id_user: decoded.userId },
      data: { confirmEmail: true },
      select: {
        id_user: true,
        first_name: true,
        last_name: true,
        email: true,
        confirmEmail: true
      }
    });

    console.log('✅ Email confirmé pour utilisateur:', updatedUser.email);

    return res.status(200).json({
      message: 'Email confirmé avec succès ! Vous pouvez maintenant vous connecter.',
      user: {
        id: updatedUser.id_user,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        email: updatedUser.email,
        confirmEmail: updatedUser.confirmEmail
      }
    });
  } catch (error) {
    console.error('❌ Erreur confirmation email POST:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expiré',
        message: 'Le lien de confirmation a expiré. Veuillez vous réinscrire.'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({
        error: 'Token invalide',
        message: 'Le lien de confirmation est invalide.'
      });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.postLogin = async (req, res) => {
  try {
    console.log("🔑 Tentative de connexion pour:", req.body.email);

    const { email, password } = req.body;

    // Validation des champs requis
    if (!email || !password) {
      console.log("❌ Champs manquants:", {
        email: !!email,
        password: !!password,
      });
      return res.status(400).json({
        error: "Email et mot de passe sont requis",
        missing: {
          email: !email,
          password: !password,
        },
      });
    }

    // Validation du format email basique
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      console.log("❌ Format email invalide:", email);
      return res.status(400).json({
        error: "Format d'email invalide",
      });
    }

    console.log(
      "🔍 Recherche utilisateur pour email:",
      email.trim().toLowerCase()
    );

    // Vérifier si l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { roleObj: true }
    });

    if (!user) {
      console.log("❌ Utilisateur non trouvé pour:", email);
      console.warn(`🔐 Tentative de connexion échouée - Email non trouvé: ${email.trim().toLowerCase()} à ${new Date().toISOString()}`);
      return res.status(404).json({
        error: "Email ou mot de passe incorrect", // Message générique pour la sécurité
      });
    }

    console.log("✅ Utilisateur trouvé, vérification du mot de passe...");

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log("❌ Mot de passe incorrect pour:", email);
      console.warn(`🔐 Tentative de connexion échouée - Mot de passe incorrect pour: ${email.trim().toLowerCase()} à ${new Date().toISOString()}`);
      return res.status(401).json({
        error: "Email ou mot de passe incorrect", // Message générique pour la sécurité
      });
    }

    // Mettre à jour la dernière connexion
    await prisma.user.update({
      where: { id_user: user.id_user },
      data: { last_connection: new Date() },
    });
    const accessToken = generateAccessToken(user.id_user);
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id_user,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
      },
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false, // mettre true en prod avec HTTPS
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Retourner les informations de l'utilisateur (sans le mot de passe)
    return res.status(200).json({
      accessToken,
      message: "Connexion réussie",
      user: {
        id: user.id_user,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.roleObj?.name || 'user',
        lastConnection: user.last_connection,
      },
    });
  } catch (error) {
    console.error("❌ Erreur lors de la connexion:", error);
    // Log stack for debugging in development
    if (process.env.NODE_ENV === 'development' && error && error.stack) {
      console.error(error.stack);
    }
    res.status(500).json({
      error: "Erreur interne du serveur",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
exports.refresh = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: "Pas de token" });

  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored || stored.expiresAt < new Date()) {
    return res.status(403).json({ error: "Token invalide ou expiré" });
  }

  try {
    // Supprimer l'ancien refresh token (rotation)
    await prisma.refreshToken.delete({ where: { token } });

    // Générer un nouveau refresh token
    const newRefreshToken = generateRefreshToken();

    // Sauvegarder le nouveau refresh token en base
    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: stored.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
      },
    });

    // Définir le nouveau refresh token dans le cookie
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false, // mettre true en prod avec HTTPS
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Générer un nouveau access token
    const newAccessToken = generateAccessToken(stored.userId);

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    console.error("❌ Erreur lors de la rotation du refresh token:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
};
exports.logout = async (req, res) => {
  try {
    const token = (req.cookies && req.cookies.refreshToken) ? req.cookies.refreshToken : null;

    // Toujours effacer le cookie côté client
    res.clearCookie('refreshToken');

    // Si un token est présent, tenter de le supprimer en base (silencieux si introuvable)
    if (token) {
      try {
        await prisma.refreshToken.deleteMany({ where: { token } });
      } catch (dbErr) {
        console.warn('Warn: erreur suppression refreshToken en DB (ignorée):', dbErr.message || dbErr);
      }
    }

    return res.status(200).json({ message: 'Déconnexion réussie' });
  } catch (error) {
    console.error('❌ Erreur lors de la déconnexion:', error);
    // Idempotence : considérer la déconnexion comme réussie côté client
    try { res.clearCookie('refreshToken'); } catch (e) {}
    return res.status(200).json({ message: 'Déconnexion réussie' });
  }
};

// --- New route handlers (full implementation) ---
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await prisma.user.findUnique({
      where: { id_user: userId },
      include: { 
        roleObj: true,
        companies: true,
        subscriptions: {
          where: { status: 'active' },
          orderBy: { start_date: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    return res.status(200).json({
      user: {
        id: user.id_user,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        avatar_url: user.avatar_url,
        confirmEmail: user.confirmEmail,
        role: user.roleObj?.name || 'user',
        creationDate: user.creation_date,
        lastConnection: user.last_connection,
        companiesCount: user.companies.length,
        subscription: user.subscriptions[0] || null
      }
    });
  } catch (error) {
    console.error('❌ Erreur getProfile:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { firstName, lastName, phone, avatar_url } = req.body;

    // Validation des données
    const updateData = {};
    if (firstName) updateData.first_name = firstName.trim();
    if (lastName) updateData.last_name = lastName.trim();
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url?.trim() || null;

    // Vérifier que l'utilisateur existe
    const existingUser = await prisma.user.findUnique({
      where: { id_user: userId }
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Mettre à jour le profil
    const updatedUser = await prisma.user.update({
      where: { id_user: userId },
      data: updateData,
      include: { roleObj: true }
    });

    return res.status(200).json({
      message: 'Profil mis à jour avec succès',
      user: {
        id: updatedUser.id_user,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        avatar_url: updatedUser.avatar_url,
        role: updatedUser.roleObj?.name || 'user'
      }
    });
  } catch (error) {
    console.error('❌ Erreur updateProfile:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.userId;

    // multer in memory to process with sharp
    // NOTE: we do not rely on client-provided mimetype; the real file type is checked
    // server-side via magic bytes (FileType.fromBuffer)
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }
    }).single('avatar');

    upload(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Fichier trop volumineux (max 5MB)' });
        }
        return res.status(400).json({ error: err.message || 'Erreur lors de l\'upload' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier fourni' });
      }

      // Obtenir le buffer : multer peut stocker en mémoire (req.file.buffer) ou sur disque (req.file.path)
      let fileBuffer;
      if (req.file.buffer && req.file.buffer.length) {
        fileBuffer = req.file.buffer;
      } else if (req.file.path) {
        try {
          fileBuffer = await fsPromises.readFile(req.file.path);
        } catch (readErr) {
          console.error('❌ Erreur lecture fichier uploadé:', readErr);
          return res.status(500).json({ error: 'Erreur lecture fichier uploadé' });
        }
      } else {
        return res.status(400).json({ error: 'Aucun contenu de fichier disponible' });
      }

      // Vérifier le type réel du fichier via signature (magic bytes)
      let detectedMime = null;
      try {
        // Détecter le type MIME via les magic bytes (signatures)
        const header = fileBuffer.slice(0, 12);
        
        if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
          detectedMime = 'image/jpeg';
        } else if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
          detectedMime = 'image/png';
        } else if (header.slice(0, 4).toString() === 'RIFF' && header.slice(8, 12).toString() === 'WEBP') {
          detectedMime = 'image/webp';
        } else if (header.slice(4, 8).toString() === 'ftyp' && (
          header.slice(8, 12).toString() === 'avif' || 
          header.slice(8, 12).toString() === 'avis'
        )) {
          detectedMime = 'image/avif';
        }
      } catch (ftErr) {
        console.error('❌ Erreur détection type fichier:', ftErr);
        return res.status(400).json({ error: 'Impossible de déterminer le type du fichier' });
      }

      if (!detectedMime) {
        return res.status(400).json({ error: 'Type de fichier non reconnu - formats supportés: JPEG, PNG, WebP, AVIF' });
      }

      // Autoriser seulement les types réellement supportés
      const ALLOWED_SIGNATURE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
      if (!ALLOWED_SIGNATURE_MIMES.includes(detectedMime)) {
        return res.status(415).json({ error: `Format non supporté : ${detectedMime}` });
      }

      // Ensure avatars dir exists
      const outDir = path.join(__dirname, '..', 'public', 'avatars');
      await fsPromises.mkdir(outDir, { recursive: true });

      // Convert to webp with sharp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const filename = `avatar-${userId}-${uniqueSuffix}.webp`;
      const outPath = path.join(outDir, filename);

      try {
        // convert and save (utiliser fileBuffer qui vient de la mémoire ou du disque)
        await sharp(fileBuffer)
          .rotate() // auto-rotate based on EXIF
          .resize({ width: 800, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outPath);
      } catch (sharpErr) {
        console.error('❌ Sharp conversion failed:', sharpErr);
        // Give a clearer error to the client when format unsupported by Sharp
        const errMessage = sharpErr && sharpErr.message ? sharpErr.message : 'Erreur conversion image';
        return res.status(422).json({ error: 'Impossible de convertir l\'image', details: errMessage });
      }

      const avatarUrl = `/avatars/${filename}`;

      // Update DB
      const updatedUser = await prisma.user.update({
        where: { id_user: userId },
        data: { avatar_url: avatarUrl },
        select: {
          id_user: true,
          first_name: true,
          last_name: true,
          avatar_url: true
        }
      });

      return res.status(200).json({
        message: 'Avatar uploadé et converti en webp avec succès',
        user: {
          id: updatedUser.id_user,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          avatar_url: updatedUser.avatar_url
        }
      });
    });
  } catch (error) {
    console.error('❌ Erreur uploadAvatar:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

exports.getCompletion = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await prisma.user.findUnique({
      where: { id_user: userId },
      include: { companies: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Calculer le pourcentage de complétion du profil
    let completionScore = 0;
    const totalFields = 8; // Nombre total de champs à remplir

    // Champs obligatoires (déjà remplis lors de l'inscription)
    if (user.first_name) completionScore++;
    if (user.last_name) completionScore++;
    if (user.email) completionScore++;
    if (user.confirmEmail) completionScore++;

    // Champs optionnels
    if (user.phone) completionScore++;
    if (user.avatar_url) completionScore++;
    if (user.companies.length > 0) completionScore++;
    if (user.roleId) completionScore++;

    const completionPercentage = Math.round((completionScore / totalFields) * 100);

    return res.status(200).json({
      completion: {
        percentage: completionPercentage,
        score: completionScore,
        total: totalFields,
        missing: {
          phone: !user.phone,
          avatar: !user.avatar_url,
          emailConfirmed: !user.confirmEmail,
          company: user.companies.length === 0,
          role: !user.roleId
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur getCompletion:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

exports.getCompanies = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const companies = await prisma.company.findMany({
      where: { owner_id: userId },
      include: {
        companyTypes: {
          include: { type: true }
        },
        inputs: {
          select: {
            id_input: true,
            name: true,
            status: true
          }
        },
        outputs: {
          select: {
            id_output: true,
            name: true,
            status: true
          }
        }
      },
      orderBy: { creation_date: 'desc' }
    });

    const companiesWithStats = companies.map(company => ({
      id: company.id_company,
      name: company.name,
      siret: company.siret,
      sector: company.sector,
      address: company.address,
      latitude: company.latitude,
      longitude: company.longitude,
      phone: company.phone,
      email: company.email,
      website: company.website,
      description: company.description,
      validationStatus: company.validation_status,
      creationDate: company.creation_date,
      lastUpdate: company.last_update,
      types: company.companyTypes.map(ct => ct.type.name),
      stats: {
        inputsCount: company.inputs.length,
        outputsCount: company.outputs.length,
        activeInputs: company.inputs.filter(i => i.status === 'active').length,
        activeOutputs: company.outputs.filter(o => o.status === 'active').length
      }
    }));

    return res.status(200).json({
      companies: companiesWithStats,
      total: companiesWithStats.length
    });
  } catch (error) {
    console.error('❌ Erreur getCompanies:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};