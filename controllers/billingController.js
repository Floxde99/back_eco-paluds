const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();
const { z } = require('zod');
const stripe = require('../services/stripe');
const { getPlans, getPlanById, getPlanByPriceId } = require('../config/billingPlans');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const paymentIntentSchema = z.object({
  planId: z.string().min(1).optional(),
  priceId: z.string().min(1).optional(),
  metadata: z.record(metadataValueSchema).optional(),
  setupFutureUsage: z.enum(['on_session', 'off_session']).optional()
}).refine(data => data.planId || data.priceId, {
  message: 'planId ou priceId est requis'
}).superRefine((data, ctx) => {
  if (data.priceId && !getPlanByPriceId(data.priceId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceId'],
      message: 'priceId inconnu'
    });
  }
}).strip();

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

function requireStripe(res) {
  if (!stripe) {
    jsonError(res, 503, 'Service de facturation indisponible (Stripe non configuré)');
    return false;
  }
  return true;
}

function formatSubscription(subscription) {
  if (!subscription) return null;

  const plan = getPlanById(subscription.subscription_type) || getPlanByPriceId(subscription.plan_id);

  return {
    id: subscription.id_subscription,
    stripeId: subscription.stripe_id,
    stripeCustomerId: subscription.stripe_customer_id,
    type: subscription.subscription_type,
    status: subscription.status,
    planId: subscription.plan_id,
    plan: plan ? {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      features: plan.features,
      billingThreshold: plan.billingThreshold,
      aiCredits: plan.aiCredits
    } : null,
    price: subscription.price,
    currency: subscription.currency,
    billingCycle: subscription.billing_cycle,
    startDate: subscription.start_date,
    endDate: subscription.end_date,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    billingThreshold: subscription.billing_threshold,
    aiConsumption: subscription.ai_consumption,
    paymentMethod: subscription.payment_method,
    metadata: subscription.metadata
  };
}

const formatCardLabel = (card) => {
  if (!card || !card.last4) return null;
  const brand = (card.brand || 'Carte').toUpperCase();
  return `${brand} **** ${card.last4}`;
};

function getPaymentMethodLabel(defaultPaymentMethod) {
  if (!defaultPaymentMethod) return null;
  if (typeof defaultPaymentMethod === 'string') return defaultPaymentMethod;
  if (defaultPaymentMethod.card) {
    return formatCardLabel(defaultPaymentMethod.card);
  }
  return defaultPaymentMethod.type || null;
}

function getPaymentIntentMethodLabel(paymentIntent) {
  if (!paymentIntent) return null;

  const paymentMethod = paymentIntent.payment_method;
  if (paymentMethod && typeof paymentMethod === 'object') {
    if (paymentMethod.card) {
      return formatCardLabel(paymentMethod.card);
    }
    if (paymentMethod.type) {
      return paymentMethod.type;
    }
  }

  const resolveCharge = () => {
    if (!paymentIntent.charges?.data?.length) return null;
    if (typeof paymentIntent.latest_charge === 'string') {
      return paymentIntent.charges.data.find(charge => charge.id === paymentIntent.latest_charge) || paymentIntent.charges.data[0];
    }
    if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object') {
      return paymentIntent.latest_charge;
    }
    return paymentIntent.charges.data[0];
  };

  const charge = resolveCharge();
  const cardDetails = charge?.payment_method_details?.card;
  if (cardDetails) {
    return formatCardLabel(cardDetails);
  }

  return charge?.payment_method_details?.type || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value * 1000);
  return new Date(value);
}

function parseUserId(value) {
  if (value === null || value === undefined) return undefined;
  const parsed = parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normaliseMetadata(metadata = {}) {
  return Object.entries(metadata).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    acc[key] = typeof value === 'string' ? value : String(value);
    return acc;
  }, {});
}

async function ensureStripeCustomer(user) {
  if (!stripe) return null;
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || undefined,
    metadata: { userId: user.id_user.toString() }
  });

  await prisma.user.update({
    where: { id_user: user.id_user },
    data: { stripe_customer_id: customer.id }
  }).catch(() => undefined);

  return customer.id;
}

function mapPaymentIntentStatus(status) {
  switch (status) {
    case 'succeeded':
      return 'active';
    case 'processing':
      return 'processing';
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'pending';
    case 'requires_capture':
      return 'pending_capture';
    case 'canceled':
      return 'canceled';
    default:
      return status || 'pending';
  }
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

async function createOrUpdateSubscriptionFromPaymentIntent(paymentIntent, userIdHint, explicitPlan) {
  if (!paymentIntent) return null;

  const customerId = typeof paymentIntent.customer === 'string'
    ? paymentIntent.customer
    : paymentIntent.customer?.id;

  let userId = parseUserId(userIdHint);
  if (!userId) userId = parseUserId(paymentIntent.metadata?.userId);

  if (!userId && customerId) {
    const user = await prisma.user.findFirst({
      where: { stripe_customer_id: customerId },
      select: { id_user: true }
    });
    if (user) {
      userId = user.id_user;
    }
  }

  if (!userId) {
    console.warn('⚠️ Impossible de rattacher le PaymentIntent à un utilisateur local', {
      paymentIntentId: paymentIntent.id,
      customerId
    });
    return null;
  }

  const plan = explicitPlan
    || getPlanById(paymentIntent.metadata?.planId)
    || getPlanByPriceId(paymentIntent.metadata?.priceId);

  const existing = await prisma.subscription.findUnique({
    where: { stripe_id: paymentIntent.id }
  }).catch(() => null);

  const normalizedStatus = mapPaymentIntentStatus(paymentIntent.status);

  if (existing && normalizedStatus === existing.status) {
    return existing;
  }

  const now = new Date();
  const startDate = existing?.start_date ?? now;
  const currentPeriodStart = normalizedStatus === 'active'
    ? (existing?.current_period_start ?? now)
    : existing?.current_period_start ?? null;

  const amount = typeof paymentIntent.amount === 'number'
    ? paymentIntent.amount / 100
    : plan?.price ?? existing?.price ?? 0;

  const currency = (paymentIntent.currency || plan?.currency || existing?.currency || 'eur').toUpperCase();

  const planId = plan?.id || paymentIntent.metadata?.planId || existing?.subscription_type || 'custom';
  const planPriceId = plan?.stripePriceId || paymentIntent.metadata?.priceId || existing?.plan_id || null;
  const billingCycle = plan?.billingCycle || existing?.billing_cycle || null;
  const billingThreshold = plan?.billingThreshold ?? existing?.billing_threshold ?? 0;
  const aiCredits = plan?.aiCredits ?? existing?.ai_consumption ?? 0;

  const metadata = {
    ...toPlainObject(existing?.metadata),
    ...normaliseMetadata(paymentIntent.metadata || {})
  };

  const paymentMethod = getPaymentIntentMethodLabel(paymentIntent) || existing?.payment_method || null;

  const baseData = {
    stripe_id: paymentIntent.id,
    stripe_customer_id: customerId || existing?.stripe_customer_id || null,
    subscription_type: planId,
    plan_id: planPriceId,
    billing_cycle: billingCycle,
    start_date: startDate,
    end_date: normalizedStatus === 'canceled' ? now : existing?.end_date ?? null,
    current_period_start: currentPeriodStart,
    current_period_end: null,
    cancel_at_period_end: false,
    price: amount,
    currency,
    status: normalizedStatus,
    billing_threshold: billingThreshold,
    payment_method: paymentMethod,
    metadata
  };

  const record = await prisma.subscription.upsert({
    where: { stripe_id: paymentIntent.id },
    create: {
      ...baseData,
      user_id: userId,
      ai_consumption: aiCredits
    },
    update: {
      ...baseData,
      ai_consumption: aiCredits
    }
  });

  if (customerId) {
    await prisma.user.update({
      where: { id_user: userId },
      data: { stripe_customer_id: customerId }
    }).catch(() => undefined);
  }

  return record;
}

async function createSubscriptionForFreePlan(user, plan, metadata) {
  const now = new Date();
  const stripeId = `free_${plan.id}_${user.id_user}`;

  const record = await prisma.subscription.upsert({
    where: { stripe_id: stripeId },
    create: {
      stripe_id: stripeId,
      stripe_customer_id: user.stripe_customer_id || null,
      subscription_type: plan.id,
      plan_id: plan.stripePriceId || null,
      billing_cycle: plan.billingCycle || null,
      start_date: now,
      end_date: null,
      current_period_start: now,
      current_period_end: null,
      cancel_at_period_end: false,
      price: 0,
      currency: (plan.currency || 'EUR').toUpperCase(),
      status: 'active',
      ai_consumption: plan.aiCredits ?? 0,
      billing_threshold: plan.billingThreshold ?? 0,
      payment_method: 'free-plan',
      metadata,
      user_id: user.id_user
    },
    update: {
      subscription_type: plan.id,
      plan_id: plan.stripePriceId || null,
      billing_cycle: plan.billingCycle || null,
      start_date: now,
      current_period_start: now,
      price: 0,
      currency: (plan.currency || 'EUR').toUpperCase(),
      status: 'active',
      ai_consumption: plan.aiCredits ?? 0,
      billing_threshold: plan.billingThreshold ?? 0,
      payment_method: 'free-plan',
      metadata
    }
  });

  return record;
}

async function applySubscriptionUpdate(stripeSubscription, userIdHint) {
  if (!stripeSubscription) return null;

  const customerId = typeof stripeSubscription.customer === 'string'
    ? stripeSubscription.customer
    : stripeSubscription.customer?.id;

  let userId = parseUserId(userIdHint);

  if (!userId && customerId) {
    const user = await prisma.user.findFirst({
      where: { stripe_customer_id: customerId },
      select: { id_user: true }
    });
    if (user) {
      userId = user.id_user;
    }
  }

  if (!userId) {
    console.warn('⚠️ Impossible de rattacher l\'abonnement Stripe à un utilisateur local', {
      stripeSubscriptionId: stripeSubscription.id,
      customerId
    });
    return null;
  }

  const priceItem = stripeSubscription.items?.data?.[0];
  const priceObject = priceItem?.price || priceItem?.plan;

  const plan = getPlanByPriceId(priceObject?.id) || getPlanById(stripeSubscription.metadata?.planId);
  const subscriptionType = plan?.id
    || stripeSubscription.metadata?.planId
    || priceObject?.nickname
    || 'custom';

  const baseData = {
    stripe_id: stripeSubscription.id,
    stripe_customer_id: customerId,
    subscription_type: subscriptionType,
    plan_id: priceObject?.id || null,
    billing_cycle: priceObject?.recurring?.interval || priceObject?.interval || null,
    start_date: toDate(stripeSubscription.start_date),
    end_date: toDate(stripeSubscription.ended_at || stripeSubscription.cancel_at),
    current_period_start: toDate(stripeSubscription.current_period_start),
    current_period_end: toDate(stripeSubscription.current_period_end),
    cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
    price: priceObject?.unit_amount != null ? priceObject.unit_amount / 100 : (plan?.price ?? 0),
    currency: (priceObject?.currency || plan?.currency || 'eur').toUpperCase(),
    status: stripeSubscription.status,
    billing_threshold: plan?.billingThreshold ?? 0,
    payment_method: getPaymentMethodLabel(stripeSubscription.default_payment_method),
    metadata: stripeSubscription.metadata || {}
  };

  const record = await prisma.subscription.upsert({
    where: { stripe_id: stripeSubscription.id },
    create: {
      ...baseData,
      user_id: userId,
      ai_consumption: plan?.aiCredits ?? 0
    },
    update: {
      ...baseData,
      ai_consumption: plan?.aiCredits ?? 0
    }
  });

  await prisma.user.update({
    where: { id_user: userId },
    data: { stripe_customer_id: customerId }
  }).catch(() => undefined);

  return record;
}

async function syncSubscriptionById(stripeSubscriptionId, userIdHint) {
  if (!stripeSubscriptionId) return null;
  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['default_payment_method', 'items.data.price']
  });
  return applySubscriptionUpdate(stripeSubscription, userIdHint);
}

async function getPlansHandler(req, res) {
  const plans = getPlans();
  return res.status(200).json({ plans });
}

async function getSubscriptionHandler(req, res) {
  try {
    const userId = req.user.userId;
    const subscription = await prisma.subscription.findFirst({
      where: { user_id: userId },
      orderBy: { start_date: 'desc' }
    });

    return res.status(200).json({ subscription: formatSubscription(subscription) });
  } catch (error) {
    console.error('❌ Erreur getSubscription:', error);
    return jsonError(res, 500, 'Erreur interne du serveur');
  }
}

async function createPaymentIntentHandler(req, res) {
  if (!requireStripe(res)) return;

  try {
    const payload = paymentIntentSchema.parse(req.body || {});
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id_user: userId },
      select: {
        id_user: true,
        email: true,
        first_name: true,
        last_name: true,
        stripe_customer_id: true
      }
    });

    if (!user) {
      return jsonError(res, 404, 'Utilisateur introuvable');
    }

    const planFromId = payload.planId ? getPlanById(payload.planId) : null;
    const planFromPrice = payload.priceId ? getPlanByPriceId(payload.priceId) : null;
    let plan = planFromId || planFromPrice;

    if (!plan) {
      return jsonError(res, 404, 'Offre introuvable');
    }

    if (payload.priceId && plan.stripePriceId && payload.priceId !== plan.stripePriceId) {
      return jsonError(res, 400, 'priceId incompatible avec l’offre s�lectionn�e');
    }

    const metadata = {
      ...normaliseMetadata(payload.metadata || {}),
      planId: plan.id,
      priceId: plan.stripePriceId || '',
      userId: user.id_user.toString(),
      planName: plan.name
    };

    const amount = Math.max(Math.round((plan.price || 0) * 100), 0);
    const currency = (plan.currency || 'EUR').toLowerCase();

    if (amount === 0) {
      const record = await createSubscriptionForFreePlan(user, plan, metadata);
      return res.status(200).json({
        subscription: formatSubscription(record),
        free: true
      });
    }

    const stripeCustomerId = await ensureStripeCustomer(user);

    const stripePayload = {
      amount,
      currency,
      customer: stripeCustomerId,
      receipt_email: user.email || undefined,
      description: `Eco-Paluds - ${plan.name}`,
      metadata,
      automatic_payment_methods: { enabled: true }
    };

    if (payload.setupFutureUsage) {
      stripePayload.setup_future_usage = payload.setupFutureUsage;
    }

    const idempotencyKey = `pi_${user.id_user}_${plan.id}_${Date.now()}`;

    const paymentIntent = await stripe.paymentIntents.create(
      stripePayload,
      { idempotencyKey }
    );

    await createOrUpdateSubscriptionFromPaymentIntent(paymentIntent, user.id_user, plan);

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      currency: paymentIntent.currency.toUpperCase(),
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currency: plan.currency
      }
    });
  } catch (error) {
    console.error('❌ Erreur createPaymentIntent:', error);
    if (error instanceof z.ZodError) {
      return jsonError(res, 400, 'Requête invalide', { details: error.flatten() });
    }
    return jsonError(res, 500, 'Erreur lors de la création du paiement');
  }
}

async function createPaypalSessionHandler(req, res) {
  return res.status(503).json({
    error: 'Paiement PayPal indisponible',
    message: 'PayPal n\'est pas encore configuré sur cette plateforme.'
  });
}

async function handleWebhookHandler(req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.warn('⚠️ Webhook Stripe reçu mais configuration manquante');
    return res.status(200).send('Stripe webhook disabled');
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).send('Unsupported content-type');
  }

  const signature = req.headers['stripe-signature'];

  if (!signature) {
    return res.status(400).send('Missing stripe-signature header');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Signature Stripe invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const eventType = event.type;
    const dataObject = event.data.object;
    const structuredLog = {
      id: event.id,
      type: eventType,
      payment_intent: dataObject?.payment_intent || (eventType.startsWith('payment_intent') ? dataObject?.id : undefined),
      customer: typeof dataObject?.customer === 'string' ? dataObject.customer : dataObject?.customer?.id,
      userId: parseUserId(dataObject?.metadata?.userId)
    };
    console.log('[stripe.webhook]', JSON.stringify(structuredLog));

    switch (eventType) {
      case 'checkout.session.completed': {
        if (dataObject.mode === 'subscription' && dataObject.subscription) {
          await syncSubscriptionById(dataObject.subscription, parseUserId(dataObject.metadata?.userId));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscriptionUpdate(dataObject, parseUserId(dataObject.metadata?.userId));
        break;
      }
      case 'invoice.payment_succeeded': {
        if (dataObject.subscription) {
          await syncSubscriptionById(dataObject.subscription, parseUserId(dataObject.metadata?.userId));
        }
        break;
      }
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        await createOrUpdateSubscriptionFromPaymentIntent(dataObject, parseUserId(dataObject.metadata?.userId));
        break;
      }
      default:
        console.log(`ℹ️ Évènement Stripe ignoré: ${eventType}`);
        break;
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Erreur traitement webhook Stripe:', error);
    res.status(500).send('Webhook handler failed');
  }
}

module.exports = {
  getPlans: getPlansHandler,
  getSubscription: getSubscriptionHandler,
  createPaymentIntent: createPaymentIntentHandler,
  createPaypalSession: createPaypalSessionHandler,
  handleWebhook: handleWebhookHandler
};

