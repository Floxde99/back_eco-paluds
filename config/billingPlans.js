const defaultCurrency = process.env.BILLING_DEFAULT_CURRENCY || 'EUR';

const plans = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Accès aux fonctions essentielles et au répertoire des entreprises.',
    price: 0,
    billingCycle: 'monthly',
    currency: defaultCurrency,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || null,
    features: [
      'Référencement de votre entreprise',
      'Consultation du répertoire des entreprises',
      'Support par email'
    ],
    billingThreshold: 0,
    aiCredits: 0
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Suivi des flux avec alertes et assistance prioritaire.',
    price: 29,
    billingCycle: 'monthly',
    currency: defaultCurrency,
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    features: [
      'Jusqu\'à 5 entreprises',
      'Alertes automatiques de flux',
      'Support prioritaire',
      '1000 crédits IA / mois'
    ],
    billingThreshold: 1000,
    aiCredits: 1000
  },
  {
    id: 'enterprise',
    name: 'Entreprise',
    description: 'Personnalisation avancée, intégrations et accompagnement dédié.',
    price: 79,
    billingCycle: 'monthly',
    currency: defaultCurrency,
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || null,
    features: [
      'Entreprises illimitées',
      'Intégrations personnalisées',
      'Gestionnaire de compte dédié',
      '10 000 crédits IA / mois'
    ],
    billingThreshold: 10000,
    aiCredits: 10000
  }
];

function serializePlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    billingCycle: plan.billingCycle,
    currency: plan.currency,
    features: plan.features,
    aiCredits: plan.aiCredits,
    billingThreshold: plan.billingThreshold,
    available: Boolean(plan.stripePriceId)
  };
}

function getPlans() {
  return plans.map(serializePlan);
}

function getPlanById(planId) {
  return plans.find(plan => plan.id === planId) || null;
}

function getPlanByPriceId(priceId) {
  if (!priceId) return null;
  return plans.find(plan => plan.stripePriceId === priceId) || null;
}

module.exports = {
  getPlans,
  getPlanById,
  getPlanByPriceId
};
