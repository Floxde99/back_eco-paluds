require('dotenv').config({ path: __dirname + '/.env' });
const helmet = require('helmet');
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();
app.set('trust proxy', 1);
const userRouter = require('./routers/userRouter');
const dashboardRouter = require('./routers/dashboardRouter');
const companyRouter = require('./routers/companyRouter');
const billingRouter = require('./routers/billingRouter');
const suggestionRouter = require('./routers/suggestionRouter');
const importRouter = require('./routers/importRouter');
const assistantRouter = require('./routers/assistantRouter');
const contactsRouter = require('./routers/contactsRouter');
const adminRouter = require('./routers/adminRouter');
const billingController = require('./controllers/billingController');
require('fs');

// Lire les origines CORS depuis .env (séparées par des virgules)
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()) 
  : ['http://localhost:5173']; // Fallback par défaut

console.log('🔧 CORS Origins configurées:', corsOrigins);

// Configuration Helmet pour autoriser les images cross-origin tout en gardant la sécurité
app.use(helmet({
  // Autoriser le chargement d'images depuis d'autres origines (nécessaire pour avatars)
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Configurer CSP pour autoriser les images depuis les origines autorisées
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: [
        "'self'",
        "data:",
        ...corsOrigins  // Utilise les mêmes origines que CORS
      ],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", ...corsOrigins],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"]
    }
  }
}));

app.use(cors({
    origin: corsOrigins, // Utilise les origines depuis .env
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// Rate limiting pour la sécurité
const rateLimit = require('express-rate-limit');

// Limiter les tentatives de connexion (5 par 15 min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives max
  message: 'Trop de tentatives de connexion, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter les uploads (10 par heure par utilisateur)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10,
  message: 'Trop d\'uploads, réessayez plus tard.',
  // Utiliser la configuration par défaut pour éviter les problèmes IPv6
  // Le rate limiting sera basé sur l'IP par défaut
});

app.post('/billing/webhook', express.raw({ type: 'application/json' }), billingController.handleWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir les fichiers statiques (avatars)
app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));

// Appliquer les rate limiters aux routes spécifiques
app.use('/login', loginLimiter);
app.use('/user/avatar', uploadLimiter);
app.use('/import/upload', uploadLimiter);

app.use('/', userRouter);
app.use('/dashboard', dashboardRouter);
app.use('/companies', companyRouter);
app.use('/billing', billingRouter);
app.use('/suggestions', suggestionRouter);
app.use('/import', importRouter);
app.use('/assistant', assistantRouter);
app.use('/contacts', contactsRouter);
app.use('/admin', adminRouter);

app.listen(process.env.PORT, (err) => {
    if (err) {
        console.error(err);
        return;
    } else {
        console.log(`connecté sur le port ${process.env.PORT}`);
    }
});

console.log('cwd:', process.cwd());
console.log('ENV check -> MAIL_HOST:', process.env.MAIL_HOST, 'MAIL_PORT:', process.env.MAIL_PORT, 'PORT:', process.env.PORT);
console.log('tokenUtils exists:', require('fs').existsSync(__dirname + '/services/tokenUtils.js'));
