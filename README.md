# Eco Paluds backend

API Node/Express + Prisma (MySQL) pour l'annuaire circulaire de la zone des Paluds.

## ⚙️ Installation
```pwsh
npm install
npm run prisma:migrate
npm run start
```

## 🧪 Tests
```pwsh
npm test
```

## 🔗 Endpoints
- `POST /company` – création d'une entreprise
- `GET /company/profile` – profil complet
- `GET /company/companies` – recherche listée (pagination, filtres)
- `GET /company/companies/filters` – facettes (secteur, type de déchets)
- `GET /company/:id` – fiche détaillée
- `POST /user/login` – connexion (JWT + refresh token)
- `POST /user/refresh` – renouveler l'access token
- `POST /user/register` – inscription + e-mail de confirmation
- `GET /billing/plans` – catalogue des offres disponibles
- `GET /billing/subscription` – état d'abonnement de l'utilisateur connecté
- `POST /billing/payment-intents` – création d'un PaymentIntent Stripe pour un plan
- `POST /billing/paypal/session` – (placeholder) indique que PayPal n'est pas encore configuré

## 🔐 Auth
JWT en Header `Authorization: Bearer <token>` via `authGuard`. Refresh token en cookie HTTP-only (rotation 7 j).

## 🗺️ Recherche & filtres
- Texte : nom, secteur, description, productions, besoins, déchets
- Filtres : secteurs (string), types de déchets (famille ou catégorie)
- Distance : Haversine si coordonnées utilisateur fournies, sinon fallback (référence Paluds)
- Pagination : `page`, `limit`

Réponse type :
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 2,
        "name": "Métal Service Aubagne",
        "sector": "Métallurgie",
        "distanceKm": 2.8,
        "tags": ["Métallurgie", "Aluminium"],
        "summary": { "productions": [...], "besoins": [...], "dechets": [...] }
      }
    ],
    "total": 1,
    "facets": {
      "sectors": [{ "value": "Métallurgie", "count": 1 }],
      "wasteTypes": [{ "value": "Aluminium", "count": 1 }]
    }
  }
}
```

## 🧵 Seed
Script `scripts/seed-companies.js` pour injecter des entreprises locales factices.
```pwsh
node scripts/seed-companies.js
```

## 💳 Configuration facturation

Ajouter les variables d'environnement suivantes dans `.env` :

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
BILLING_DEFAULT_CURRENCY=EUR
FRONTEND_URL=http://localhost:5173
```

- Le webhook Stripe doit cibler `POST /billing/webhook` (corps brut `application/json`).
- Les prix peuvent être désactivés (plan non disponible) en omettant leur identifiant.
- Les routes `/billing/*` nécessitent un JWT valide (authGuard).
