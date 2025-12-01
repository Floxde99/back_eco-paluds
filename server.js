require('dotenv').config({ path: __dirname + '/.env' });
const helmet = require('helmet');
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('./services/logger');
const { RATE_LIMIT } = require('./config/constants');
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
const { startRefreshTokenCleanup } = require('./services/refreshTokenMaintenance');

// Lire les origines CORS depuis .env (séparées par des virgules)
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()) 
  : ['http://localhost:5173']; // Fallback par défaut

logger.info('CORS Origins configurées', { corsOrigins });

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

const ACCESS_TOKEN_HEADER = 'x-access-token';
app.use((req, res, next) => {
  const existing = res.getHeader('Access-Control-Expose-Headers');
  if (!existing) {
    res.setHeader('Access-Control-Expose-Headers', ACCESS_TOKEN_HEADER);
    return next();
  }
  const list = Array.isArray(existing)
    ? existing
    : existing.split(',').map(value => value.trim());
  if (!list.map(value => value.toLowerCase()).includes(ACCESS_TOKEN_HEADER)) {
    list.push(ACCESS_TOKEN_HEADER);
    res.setHeader('Access-Control-Expose-Headers', list.join(', '));
  }
  return next();
});

// Rate limiting pour la sécurité
const rateLimit = require('express-rate-limit');

// Limiter les tentatives de connexion
const loginLimiter = rateLimit({
  windowMs: RATE_LIMIT.LOGIN.WINDOW_MS,
  max: RATE_LIMIT.LOGIN.MAX_ATTEMPTS,
  message: 'Trop de tentatives de connexion, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter les uploads
const uploadLimiter = rateLimit({
  windowMs: RATE_LIMIT.UPLOAD.WINDOW_MS,
  max: RATE_LIMIT.UPLOAD.MAX_ATTEMPTS,
  message: 'Trop d\'uploads, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: RATE_LIMIT.WEBHOOK.WINDOW_MS,
  max: RATE_LIMIT.WEBHOOK.MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/billing/webhook', webhookLimiter, express.raw({ type: 'application/json' }), billingController.handleWebhook);

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

startRefreshTokenCleanup();

// Middleware global de gestion d'erreurs (doit être après toutes les routes)
app.use((err, req, res, next) => {
  logger.error('Erreur non gérée', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.listen(process.env.PORT, (err) => {
    if (err) {
        logger.error('Erreur au démarrage du serveur', { error: err.message });
        return;
    } else {
        logger.info(`Serveur connecté sur le port ${process.env.PORT}`);
    }
});

logger.info('Environnement de travail', {
  cwd: process.cwd(),
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT
});
