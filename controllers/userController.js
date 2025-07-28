const {PrismaClient} = require('../generated/prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

exports.addUser = async (req, res) => {
    try {
        // Debug: Logger les données reçues complètes
        console.log('🔍 Données reçues complètes:', req.body);

        // Normaliser les noms de champs - accepter les deux formats
        const firstName = req.body.firstName || req.body.first_name;
        const lastName = req.body.lastName || req.body.last_name;
        const email = req.body.email;
        const password = req.body.password;
        const confirmPassword = req.body.confirmPassword;
        const phone = req.body.phone;
        const role = req.body.role || 'user';

        console.log('🔍 Données normalisées:', {
            firstName,
            lastName,
            email,
            phone,
            role,
            passwordLength: password?.length,
            confirmPasswordLength: confirmPassword?.length,
        });

        // Debug: Logger les mots de passe (masqués pour la sécurité)
        console.log('🔐 Validation mots de passe:', {
            password: `${password?.substring(0, 3)}***`,
            confirmPassword: `${confirmPassword?.substring(0, 3)}***`,
            areEqual: password === confirmPassword,
            passwordType: typeof password,
            confirmPasswordType: typeof confirmPassword
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
                    confirmPassword: !confirmPassword
                },
                received: {
                    first_name: req.body.first_name,
                    last_name: req.body.last_name,
                    email: req.body.email,
                    password: !!req.body.password,
                    confirmPassword: !!req.body.confirmPassword
                }
            });
        }

        // Trimmer les espaces invisibles (si pas déjà fait côté front)
        const cleanPassword = password.trim();
        const cleanConfirmPassword = confirmPassword.trim();

        console.log('🔐 Après trim:', {
            passwordLength: cleanPassword.length,
            confirmPasswordLength: cleanConfirmPassword.length,
            areEqual: cleanPassword === cleanConfirmPassword
        });

        if (cleanPassword !== cleanConfirmPassword) {
            return res.status(400).json({ 
                error: "Les mots de passe ne correspondent pas",
                debug: {
                    passwordLength: cleanPassword.length,
                    confirmPasswordLength: cleanConfirmPassword.length,
                    password: cleanPassword.split('').map(c => c.charCodeAt(0)).join(','),
                    confirmPassword: cleanConfirmPassword.split('').map(c => c.charCodeAt(0)).join(',')
                }
            });
        }

        // Vérifier si l'email existe déjà
        const existingUser = await prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() }
        });

        if (existingUser) {
            return res.status(409).json({ 
                error: "Un utilisateur avec cet email existe déjà" 
            });
        }

        const hashedPassword = await bcrypt.hash(cleanPassword, 10);
        const newUser = await prisma.user.create({
            data: {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                email: email.trim().toLowerCase(),
                password: hashedPassword,
                phone: phone?.trim() || null,
                role: role.trim()
            },
        });

        console.log('✅ Utilisateur créé avec succès:', {
            id: newUser.id_user,
            email: newUser.email
        });

        // Retourner une réponse JSON au lieu d'une redirection
        return res.status(201).json({ 
            message: "Utilisateur créé avec succès",
            user: {
                id: newUser.id_user,
                firstName: newUser.first_name,
                lastName: newUser.last_name,
                email: newUser.email,
                role: newUser.role
            }
        });

    } catch (error) {
        console.error('❌ Erreur lors de la création de l\'utilisateur:', error);
        
        // Gestion d'erreurs spécifiques
        if (error.code === 'P2002') {
            return res.status(409).json({ 
                error: "Un utilisateur avec cet email existe déjà" 
            });
        }

        res.status(500).json({ 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

exports.postLogin = async (req, res) => {
    try {
        console.log('🔑 Tentative de connexion pour:', req.body.email);
        
        const { email, password } = req.body;

        // Validation des champs requis
        if (!email || !password) {
            console.log('❌ Champs manquants:', { email: !!email, password: !!password });
            return res.status(400).json({ 
                error: "Email et mot de passe sont requis",
                missing: {
                    email: !email,
                    password: !password
                }
            });
        }

        // Validation du format email basique
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            console.log('❌ Format email invalide:', email);
            return res.status(400).json({ 
                error: "Format d'email invalide" 
            });
        }

        console.log('🔍 Recherche utilisateur pour email:', email.trim().toLowerCase());

        // Vérifier si l'utilisateur existe
        const user = await prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() }
        });

        if (!user) {
            console.log('❌ Utilisateur non trouvé pour:', email);
            return res.status(404).json({ 
                error: "Email ou mot de passe incorrect" // Message générique pour la sécurité
            });
        }

        console.log('✅ Utilisateur trouvé, vérification du mot de passe...');

        // Vérifier le mot de passe
        const isPasswordValid = await bcrypt.compare(password.trim(), user.password);
        if (!isPasswordValid) {
            console.log('❌ Mot de passe incorrect pour:', email);
            return res.status(401).json({ 
                error: "Email ou mot de passe incorrect" // Message générique pour la sécurité
            });
        }

        // Mettre à jour la dernière connexion
        await prisma.user.update({
            where: { id_user: user.id_user },
            data: { last_connection: new Date() }
        });

        console.log('✅ Connexion réussie pour:', email);

        // Retourner les informations de l'utilisateur (sans le mot de passe)
        return res.status(200).json({ 
            message: "Connexion réussie",
            user: {
                id: user.id_user,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                role: user.role,
                lastConnection: user.last_connection
            }
        });

    } catch (error) {
        console.error('❌ Erreur lors de la connexion:', error);
        res.status(500).json({ 
            error: "Erreur interne du serveur",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};