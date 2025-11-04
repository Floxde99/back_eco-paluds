# EcoConnect Paluds – Backend API

Plateforme API Node.js/Express pensée pour l’économie circulaire de la zone des Paluds : annuaire d’entreprises, matching intelligent de ressources, assistant IA et facturation par abonnement.

---

## 📦 Principales fonctionnalités
- **Annuaire entreprises** : création, mise à jour et recherche géolocalisée avec filtres dynamiques (secteur, types de déchets, tags).
- **Suggestions intelligentes** : algorithme de scoring (ressources, quantités, proximité, secteur) avec explications et historique utilisateur.
- **Module d’import** : ingestion de fichiers métiers (Excel) avec analyses, diagnostics et suivi des optimisations.
- **Facturation Stripe** : plans d’abonnement, création de PaymentIntent, suivi des souscriptions et webhook sécurisé.
- **Assistant IA** : copilote métier connecté au contexte utilisateur (données, suggestions, abonnement) propulsé par l’API Mistral.
- **Sécurité avancée** : authentification JWT, refresh token rotatif sécurisé en base, quotas IA, protection anti-profanité, rate limiting.

---

## 🛠️ Stack technique

| Domaine | Technologies |
| --- | --- |
| Runtime & Serveur | Node.js (CommonJS), Express 5, CORS, Helmet, express-rate-limit, cookie-parser |
| ORM & Base | Prisma, MySQL (via `DATABASE_URL`) |
| Authentification | JSON Web Tokens (`jsonwebtoken`), cookies HTTP-only, bcrypt |
| Fronts externes | Stripe, Mistral AI, Nodemailer SMTP |
| Utilitaires | Zod (validation), Multer & Sharp (uploads avatar), crypto, node-fetch |
| Qualité & scripts | nodemon, scripts Prisma, seed de données |

---

## 📁 Structure du projet

```
back/
├─ server.js                # Point d’entrée Express + middlewares globaux
├─ controllers/             # Logique métier par domaine (user, company, billing, import, assistant…)
├─ routers/                 # Définition REST des routes publiques
├─ services/                # Services transverses (authGuard, tokens, IA, mail, Stripe…)
├─ prisma/
│  ├─ schema.prisma         # Modèle de données MySQL
│  ├─ models/*.prisma       # Décomposition par entité
│  └─ migrations/           # Historique des migrations Prisma
├─ generated/prisma/        # Prisma Client généré (ne pas modifier à la main)
├─ config/                  # Plans de facturation et constantes métier
├─ public/avatars/          # Stockage avatars utilisateurs (générés en webp)
├─ scripts/                 # Outils CLI (sync modèles, seed, cleanup…)
├─ test-*.json              # Jeux d’essai pour import et création entreprise
└─ README.md
```

---

## 🚀 Mise en route

### 1. Prérequis
- Node.js ≥ 18 (développement réalisé en Node 22.13.1)
- MySQL 8 (local ou hébergé)
- Stripe (clé secrète + produits), compte SMTP, clé API Mistral
- PowerShell (pwsh) ou Bash pour exécuter les scripts

### 2. Installation
```pwsh
git clone <repo>
cd back
npm install
```

### 3. Configuration environnement
Créer un fichier `.env` à la racine et renseigner :

```dotenv
# Serveur & connexions
PORT=3001
DATABASE_URL="mysql://user:password@localhost:3306/ecoconnect"
CORS_ORIGINS=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Authentification
JWT_SECRET=change-me
# (optionnel) JWT_ACCESS_SECRET, JWT_EMAIL_SECRET pour séparer les usages

# Emails
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USER=no-reply@example.com
MAIL_PASS=app-password
SUPPORT_EMAIL=support@example.com

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
BILLING_DEFAULT_CURRENCY=EUR

# Assistant IA
MISTRAL_API_KEY=sk-...
MISTRAL_MODEL=mistral-small-latest
ASSISTANT_DAILY_LIMIT=200
ASSISTANT_BURST_LIMIT=8

# Divers
ASSISTANT_DEFAULT_ROUTE=/dashboard
NODE_ENV=development
```

> ℹ️ `JWT_ACCESS_SECRET` et `JWT_EMAIL_SECRET` sont facultatifs : si non fournis, `JWT_SECRET` est utilisé comme valeur de repli.

### 4. Préparer la base MySQL
```pwsh
npx prisma migrate deploy       # appliquer les migrations existantes
# ou en dev
npm run prisma:migrate          # génère + applique la migration pour vos changements
```

### 5. Lancer l’API
```pwsh
npm run start    # nodemon server.js
```

Le serveur écoute sur `http://localhost:${PORT}` et expose automatiquement les ressources REST.

---

## 🧰 Scripts NPM utiles

| Commande | Description |
| --- | --- |
| `npm run start` | Lance le serveur en mode watch (nodemon) |
| `npm run prisma:generate` | Synchronise les modèles Prisma (`scripts/sync-prisma-models.js` + `prisma generate`) |
| `npm run prisma:migrate` | Synchronise les modèles puis crée/applique une migration de dev |
| `npm run prisma:deploy` | Applique les migrations existantes (CI/CD) |
| `npm run prisma:studio` | Ouvre Prisma Studio |
| `node scripts/seed-companies.js` | Seed d’entreprises locales factices |
| `node scripts/cleanup-avatars.js` | Nettoyage des avatars orphelins |

> Aucun test automatisé n’est fourni pour l’instant (`npm test` renvoie un placeholder).

---

## 🔐 Authentification & sécurité
- **Login (`POST /user/login`)** : vérifie le mot de passe (bcrypt), issue un access token JWT (15 min) + refresh token aléatoire.
- **Refresh (`POST /user/refresh`)** : rotation obligatoire (création d’un nouveau refresh token, stockage hashé SHA-256).
- **Protection routes** : middleware `authGuard` (Bearer token) qui tente aussi un refresh automatique si l’access token est expiré.
- **Cookies sécurisés** : refresh token stocké en cookie `HttpOnly`, `SameSite=strict`, `Secure` en production.
- **Email confirmation** : token signé 24h, validation via `GET/POST /confirm-email`.
- **Rate limiting** : limites spécifiques pour login et uploads via `express-rate-limit`.

---

## 🧭 Modules métier

### Entreprises & annuaire
- CRUD entreprise, gestion des productions/besoins/déchets, géolocalisation.
- Recherche avec filtres avancés (`GET /companies`) : texte plein, secteurs, types de déchets, distance, tri.
- Facettes dynamiques (`GET /companies/filters`).

### Suggestions intelligentes
- Matching bidirectionnel productions ↔ besoins ↔ déchets.
- Score total /100 : ressources (40), proximité (30), quantité (20), secteur (10).
- Raisons détaillées (famille/catégorie correspondante, distance, complémentarité sectorielle).
- Historique utilisateur persistant (`suggestion_interactions`) avec statuts `new`, `saved`, `ignored`, `contacted`.
- API :
  - `GET /suggestions` (liste filtrable, stats, filtres)
  - `GET /suggestions/stats`
  - `GET /suggestions/filters`
  - `POST /suggestions/:id/{ignore|save|contact}`

### Imports & analyses
- Traitement de fichiers métiers (Excel) avec `exceljs`.
- Génération d’analyses, détection d’opportunités et suivi des optimisations.

### Assistant IA
- Conversation persistée (tables `assistant_*`).
- Prompt contextuel enrichi avec les données de l’utilisateur (entreprise, imports, suggestions, abonnement).
- Quotas journaliers et anti-spam (defense burst window).
- Escalade support → email automatique via `mailer.js`.

### Facturation
- Plans définis dans `config/billingPlans.js`.
- API Stripe : création de PaymentIntent, gestion des souscriptions, consommation IA.
- Webhook `POST /billing/webhook` (payload brut, vérifier signature Stripe).

### Administration
- Tableau de bord admin (`GET /admin/dashboard/metrics`) : volumes entreprises, connexions, complétion profils, modération.
- Gestion centralisée des entreprises : listing filtré, export CSV, création/édition/suppression via `/admin/companies`.
- File de modération dédiée (`GET /admin/moderation/pending`) et statistiques système (`GET /admin/system-stats`).

---

## 🔗 Panorama des endpoints

| Domaine | Routes principales |
| --- | --- |
| Auth & utilisateur | `POST /user/register`, `POST /user/login`, `POST /user/refresh`, `POST /logout`, `GET/PUT /user/profile`, gestion avatar |
| Entreprises | `GET /companies/profile`, `POST /companies`, `PUT /companies/general`, `GET /companies`, `GET /companies/:id`, CRUD productions/besoins/déchets |
| Suggestions | cf. section précédente |
| Imports | `POST /import/upload`, suivi des analyses, historique |
| Dashboard | `GET /dashboard/...` (statistiques globales) |
| Facturation | `GET /billing/plans`, `POST /billing/payment-intents`, `GET /billing/subscription`, `POST /billing/webhook` |
| Administration | `GET /admin/dashboard/metrics`, `GET/POST/PATCH/DELETE /admin/companies`, `GET /admin/companies/export`, `GET /admin/moderation/pending`, `GET /admin/system-stats` |
| Assistant | `POST /assistant/messages`, `GET /assistant/conversations`, escalade support |
| Contacts | `POST /contacts` (prise de contact) |

> Le détail complet se trouve dans les fichiers du dossier `routers/` et `controllers/`.

---

## 🗄️ Base de données & Prisma
- Modèle principal : `prisma/schema.prisma` (MySQL). Chaque entité est aussi disponible dans `prisma/models/*.prisma`.
- Migrations versionnées dans `prisma/migrations/`.
- Client généré dans `generated/prisma/` (commité pour simplifier le déploiement).
- Commandes utiles :
  - `npm run prisma:migrate` (dev : nouvelle migration + apply)
  - `npm run prisma:generate`
  - `npm run prisma:studio`
- Script `scripts/sync-prisma-models.js` utilisé avant chaque génération/migration pour consolider les modèles modulaires.

---

## 📊 Logs & Monitoring
- Logs applicatifs détaillés (console) pour les opérations clés : enregistrement utilisateur, suggestions, mailer, assistant.
- Les erreurs critiques sont remontées dans la console et conservées dans les colonnes `error` / `metadata` des tables concernées.

---

## 🧪 Tests & qualité
- Aucun test automatique n’est livré pour l’instant (`npm test` retourne un placeholder).
- Recommandation : ajouter Postman ou une suite de tests e2e couvrant les principaux scénarios (auth, suggestions, billing, assistant).

---

## 📤 Déploiement (VPS)
- **Préparation serveur** :
  1. Installer Node.js (version LTS), npm, Git et MySQL (ou pointer vers une base externe sécurisée).
  2. Créer un utilisateur Unix dédié (`adduser ecopaluds` + droits sur le dossier projet).
  3. Ouvrir le port HTTP interne (ex. `PORT=3001`) uniquement en local et configurer un reverse proxy (Nginx, Caddy…) pour exposer le domaine public en HTTPS.

- **Déploiement applicatif** :
  1. `git clone` du dépôt sur le VPS puis `npm ci`.
  2. Copier le fichier `.env` (ne jamais le versionner) et vérifier les secrets (JWT, Stripe, Mistral, SMTP…).
  3. `npm run prisma:generate` puis `npm run prisma:deploy` pour appliquer les migrations sur la base ciblée.
  4. Lancer l’API via un process manager type **PM2** ou un service **systemd** :
     ```bash
     pm2 start server.js --name ecopaluds-api
     pm2 save
     pm2 startup
     ```
     ou via un unit file `/etc/systemd/system/ecopaluds.service` lançant `node server.js`.

- **Reverse proxy / HTTPS** :
  - Configurer Nginx (ou équivalent) pour :
    - proxy_pass `http://127.0.0.1:3001` ;
    - ajouter les en-têtes `X-Forwarded-*` ;
    - exposer un certificat TLS (LetsEncrypt + certbot recommandé) ;
    - définir la route Stripe webhook `/billing/webhook` en `proxy_pass` brut (désactiver la réécriture du corps).

- **Sécurité & maintenance** :
  - Limiter l’accès SSH (fail2ban, clé privée, pare-feu UFW).
  - S’assurer que le dossier `public/avatars` est persistant (volume ou montage dédié) et que l’utilisateur exécutant Node a les droits d’écriture.
  - Planifier des sauvegardes régulières de la base MySQL et des fichiers publics.
  - Surveiller les journaux (`pm2 logs`, `journalctl -u ecopaluds.service`) et mettre à jour le système (`apt upgrade`) régulièrement.

- **CI/CD (optionnel)** : prévoir un workflow qui déclenche `npm ci`, `npm run prisma:generate`, `npm run prisma:deploy`, puis restart du service (`pm2 restart ecopaluds-api` ou `systemctl restart ecopaluds`).

---

## 🤝 Contribution
1. Créer une branche (`git checkout -b feature/ma-fonctionnalite`).
2. Mettre à jour/ajouter des migrations si le schéma évolue.
3. Documenter les nouvelles routes dans ce README.
4. Soumettre une MR/PR détaillant les changements.

---

## 📚 Ressources complémentaires
- Prisma docs : https://www.prisma.io/docs
- Stripe API : https://stripe.com/docs/api
- Mistral API : https://docs.mistral.ai
- Nodemailer : https://nodemailer.com/about/

---

💡 **Besoin d’aide ?** Consulte `scripts/` pour des exemples (seed, nettoyage), ou crée un ticket avec la console (`console.log`) active pour partager les logs pertinents.
