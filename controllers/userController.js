const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../services/tokenUtils");
const { sendMail } = require('../services/mailer');

// Configuration de multer pour l'upload d'avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/avatars/');
  },
  filename: (req, file, cb) => {
    // Générer un nom unique pour éviter les conflits
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + req.user.userId + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtre pour n'accepter que les images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Seules les images sont autorisées'), false);
  }
};

// Configuration multer
const uploadAvatar = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  }
}).single('avatar');

exports.register = async (req, res) => {
  try {
    // Debug: Logger les données reçues complètes
    console.log("🔍 Données reçues complètes:", req.body);

    // Normaliser les noms de champs - accepter les deux formats
    const firstName = req.body.firstName || req.body.first_name;
    const lastName = req.body.lastName || req.body.last_name;
    const email = req.body.email;
    const password = req.body.password;
    const confirmPassword = req.body.confirmPassword;
    const phone = req.body.phone;
    const role = req.body.role || "user";

    console.log("🔍 Données normalisées:", {
      firstName,
      lastName,
      email,
      phone,
      role,
      passwordLength: password?.length,
      confirmPasswordLength: confirmPassword?.length,
    });

    // Debug: Logger les mots de passe (masqués pour la sécurité)
    console.log("🔐 Validation mots de passe:", {
      password: `${password?.substring(0, 3)}***`,
      confirmPassword: `${confirmPassword?.substring(0, 3)}***`,
      areEqual: password === confirmPassword,
      passwordType: typeof password,
      confirmPasswordType: typeof confirmPassword,
    });

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

    console.log("🔐 Après trim:", {
      passwordLength: cleanPassword.length,
      confirmPasswordLength: cleanConfirmPassword.length,
      areEqual: cleanPassword === cleanConfirmPassword,
    });

    if (cleanPassword !== cleanConfirmPassword) {
      return res.status(400).json({
        error: "Les mots de passe ne correspondent pas",
        debug: {
          passwordLength: cleanPassword.length,
          confirmPasswordLength: cleanConfirmPassword.length,
          password: cleanPassword
            .split("")
            .map((c) => c.charCodeAt(0))
            .join(","),
          confirmPassword: cleanConfirmPassword
            .split("")
            .map((c) => c.charCodeAt(0))
            .join(","),
        },
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

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

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
    // Envoi d'un email de bienvenue (non bloquant)
    (async () => {
      try {
        const subject = 'Bienvenue sur Eco-Paluds !';
        const text = `Bonjour ${newUser.first_name} ${newUser.last_name},\n\nMerci de vous être inscrit(e) sur Eco-Paluds.`;
        const html = `<p>Bonjour <strong>${newUser.first_name} ${newUser.last_name}</strong>,</p><p>Merci de vous être inscrit(e) sur <em>Eco-Paluds</em>.</p>`;
        await sendMail(newUser.email, subject, text, html);
        console.log('✅ Mail de bienvenue envoyé à', newUser.email);
      } catch (mailErr) {
        console.error('❌ Échec envoi mail bienvenue:', mailErr);
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
      return res.status(404).json({
        error: "Email ou mot de passe incorrect", // Message générique pour la sécurité
      });
    }

    console.log("✅ Utilisateur trouvé, vérification du mot de passe...");

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log("❌ Mot de passe incorrect pour:", email);
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

  const newAccessToken = generateAccessToken(stored.userId);
  res.json({ accessToken: newAccessToken });
};
exports.logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: "Pas de token" });

  await prisma.refreshToken.deleteMany({ where: { token } });
  res.clearCookie("refreshToken");
  res.json({ message: "Déconnexion réussie" });
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

    // Configuration multer pour l'upload d'avatar
    const multer = require('multer');
    const path = require('path');

    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, 'public/avatars/');
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + userId + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });

    const fileFilter = (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Seules les images sont autorisées'), false);
      }
    };

    const upload = multer({
      storage: storage,
      fileFilter: fileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
      }
    }).single('avatar');

    // Traiter l'upload avec multer
    upload(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Fichier trop volumineux (max 5MB)' });
          }
        }
        return res.status(400).json({ error: err.message || 'Erreur lors de l\'upload' });
      }

      // Vérifier si un fichier a été uploadé
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier fourni' });
      }

      // Construire l'URL de l'avatar
      const avatarUrl = `/avatars/${req.file.filename}`;

      // Mettre à jour l'avatar de l'utilisateur dans la base de données
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
        message: 'Avatar uploadé avec succès',
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