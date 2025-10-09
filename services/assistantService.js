const { PrismaClient } = require('../generated/prisma/client');
const { sendMail } = require('./mailer');
const { hasProfanity } = require('./profanityFilter');

const fetchFn = global.fetch || ((...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)));

const prisma = new PrismaClient();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_DAILY_USER_MESSAGES = Number.parseInt(process.env.ASSISTANT_DAILY_LIMIT || '200', 10);
const BURST_WINDOW_MS = 30 * 1000;
const MAX_BURST_MESSAGES = Number.parseInt(process.env.ASSISTANT_BURST_LIMIT || '8', 10);
const TEXT_SEGMENT_TYPE = 'text';

const NAVIGATION_ROUTES = {
  dashboard: '/dashboard',
  analyses: '/analyses',
  inputs: '/resources/inputs',
  outputs: '/resources/outputs',
  partners: '/partners',
  suggestions: '/suggestions',
  transports: '/transports',
  subscription: '/account/subscription',
  profile: '/account/profile',
  support: '/support',
  settings: '/settings'
};

const QUICK_ACTIONS = [
  {
    id: 'analyser-opportunites',
    label: 'Analyser mes opportunités',
    prompt: "Analyse les opportunités d'économie circulaire pour l'utilisateur en fonction de ses données actuelles. Donne des recommandations numérotées en français."
  },
  {
    id: 'optimiser-profil',
    label: 'Optimiser mon profil',
    prompt: "Propose trois actions concrètes pour améliorer le profil de l'entreprise dans l'application EcoConnect Paluds."
  },
  {
    id: 'trouver-partenaires',
    label: 'Trouver des partenaires',
    prompt: "Suggère des types de partenaires locaux pertinents et explique pourquoi ils correspondent."
  }
];

async function ensureConversation(userId, conversationId, quickActionId) {
  if (conversationId) {
    const existing = await prisma.assistantConversation.findFirst({
      where: { id_assistant_conversation: conversationId, user_id: userId }
    });
    if (existing) {
      return existing;
    }
  }

  const quickAction = QUICK_ACTIONS.find((item) => item.id === quickActionId);
  const title = quickAction ? quickAction.label : 'Nouvelle conversation';
  return prisma.assistantConversation.create({
    data: {
      user_id: userId,
      title,
      metadata: quickAction ? { quickActionId: quickAction.id } : undefined
    }
  });
}

async function createConversation(userId, { title, quickActionId, context } = {}) {
  const quickAction = QUICK_ACTIONS.find((item) => item.id === quickActionId);
  const conversation = await prisma.assistantConversation.create({
    data: {
      user_id: userId,
      title: title || quickAction?.label || 'Nouvelle conversation',
      metadata: {
        ...(quickAction ? { quickActionId: quickAction.id } : {}),
        ...(context ? { context } : {})
      }
    }
  });

  await prisma.assistantTelemetry.create({
    data: {
      conversation_id: conversation.id_assistant_conversation,
      message_id: null,
      user_id: userId,
      event_type: 'conversation_created',
      data: {
        quickActionId: quickActionId || null
      }
    }
  });

  return conversation;
}

async function fetchContext(userId) {
  const company = await prisma.company.findFirst({
    where: { owner_id: userId },
    select: {
      id_company: true,
      name: true,
      sector: true,
      address: true,
      validation_status: true,
      website: true,
      description: true,
      creation_date: true,
      last_update: true,
      companyTypes: {
        take: 5,
        include: {
          type: {
            select: { name: true }
          }
        }
      }
    }
  });

  const recentImportsPromise = prisma.importAnalysis.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 3,
    select: {
      id_import_analysis: true,
      precision_score: true,
      predictions: true,
      optimizations: true,
      financial_impact: true,
      created_at: true
    }
  });

  const recentInputsPromise = company
    ? prisma.input.findMany({
        where: { company_id: company.id_company },
        orderBy: { last_update: 'desc' },
        take: 5,
        select: {
          name: true,
          category: true,
          status: true,
          unit_measure: true,
          last_update: true
        }
      })
    : Promise.resolve([]);

  const recentOutputsPromise = company
    ? prisma.output.findMany({
        where: { company_id: company.id_company },
        orderBy: { last_update: 'desc' },
        take: 5,
        select: {
          name: true,
          category: true,
          status: true,
          unit_measure: true,
          last_update: true
        }
      })
    : Promise.resolve([]);

  const suggestionInteractionsPromise = prisma.suggestionInteraction.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 3,
    select: {
      id_suggestion: true,
      status: true,
      last_score: true,
      distance_km: true,
      reasons: true,
      metadata: true,
      created_at: true
    }
  });

  const subscriptionPromise = prisma.subscription.findFirst({
    where: { user_id: userId, status: { in: ['active', 'trialing'] } },
    orderBy: { start_date: 'desc' },
    select: {
      subscription_type: true,
      plan_id: true,
      status: true,
      current_period_end: true,
      billing_threshold: true,
      ai_consumption: true
    }
  });

  const partnerCatalogPromise = prisma.partner.findMany({
    take: 5,
    orderBy: { partner_id: 'desc' },
    select: {
      partner_id: true,
      name: true,
      service_type: true,
      coverage_area: true,
      capacity: true,
      rate: true,
      status: true
    }
  });

  const familyCatalogPromise = prisma.family.findMany({
    take: 5,
    orderBy: { id_family: 'asc' },
    select: {
      id_family: true,
      name: true
    }
  });

  const platformSnapshotPromise = prisma.$transaction([
    prisma.company.count(),
    prisma.partner.count(),
    prisma.transport.count(),
    prisma.importAnalysis.count(),
    prisma.suggestionInteraction.count({ where: { status: { in: ['accepted', 'in_discussion', 'converted'] } } })
  ]);

  const usageCountsPromise = company
    ? prisma.$transaction([
        prisma.input.count({ where: { company_id: company.id_company } }),
        prisma.output.count({ where: { company_id: company.id_company } }),
        prisma.importAnalysis.count({ where: { user_id: userId } })
      ])
    : Promise.resolve([0, 0, 0]);

  const [
    recentImports,
    recentInputs,
    recentOutputs,
    suggestions,
    subscription,
    partnerCatalog,
    familyCatalog,
    platformSnapshot,
    usageCounts
  ] = await Promise.all([
    recentImportsPromise,
    recentInputsPromise,
    recentOutputsPromise,
    suggestionInteractionsPromise,
    subscriptionPromise,
    partnerCatalogPromise,
    familyCatalogPromise,
    platformSnapshotPromise,
    usageCountsPromise
  ]);

  const [inputCount, outputCount, analysisCount] = usageCounts || [0, 0, 0];
  const [companyCount, partnerCount, transportCount, analysisTotalCount, suggestionEngagementCount] =
    platformSnapshot || [0, 0, 0, 0, 0];

  return {
    company,
    analyses: recentImports,
    inputs: recentInputs,
    outputs: recentOutputs,
    suggestions,
    subscription,
    partnerCatalog,
    familyCatalog,
    platform: {
      companies: companyCount,
      partners: partnerCount,
      transports: transportCount,
      analyses: analysisTotalCount,
      suggestionEngagements: suggestionEngagementCount
    },
    usage: {
      inputs: inputCount,
      outputs: outputCount,
      analyses: analysisCount
    }
  };
}

function buildSystemPrompt(context, conversation) {
  const quickActionMetadata = conversation?.metadata?.quickActionId
    ? QUICK_ACTIONS.find((item) => item.id === conversation.metadata.quickActionId)
    : null;

  const lines = [
    "Tu es l'assistant IA d'EcoConnect Paluds, la plateforme métier dédiée aux flux d'économie circulaire.",
    'Réponds exclusivement en français, avec un ton expert mais accessible et orienté action.',
    "Ton rôle est d'aider l'utilisateur à exploiter les modules de l'application : Analyses d'import, Gestion des intrants/extrants, Suggestions de partenaires, Suivi d'abonnement.",
    'Structure toujours ta réponse en points numérotés (1., 2., 3., ...) et termine par un appel à l’action concret pointant vers un module ou une activité EcoConnect.',
    'Quand tu manques de données, dis-le explicitement puis propose comment les collecter dans EcoConnect (ex. importer un fichier, compléter une fiche ressource, valider un partenaire).',
    "Précise les hypothèses ou limites de chaque recommandation et invite à consulter les sections pertinentes de l'application.",
    'Si une contrainte réglementaire ou locale peut impacter la recommandation, signale-la brièvement.'
  ];

  if (quickActionMetadata) {
    lines.push(`Contexte Quick Action: ${quickActionMetadata.label}. Priorise des recommandations alignées avec cet objectif.`);
  }

  lines.push('Routes disponibles pour orienter l’utilisateur (utilise `route:<clé>` dans les actions) :');
  Object.entries(NAVIGATION_ROUTES).forEach(([key, path]) => {
    lines.push(`- ${key} → ${path}`);
  });

  lines.push('Format attendu de la réponse :');
  lines.push('1. Utilise des titres Markdown (`##`) pour séparer Synthèse, Analyses, Recommandations.');
  lines.push('2. Détailles les actions prioritaires en liste numérotée (1., 2., 3., …) avec justification basée sur les données EcoConnect.');
  lines.push('3. Les compléments ou conseils secondaires peuvent être en liste à puces.');
  lines.push('4. Termine impérativement par une section `## Actions` contenant une puce par bouton au format `- [Nom du bouton](route:clé)` en t’assurant que la clé est listée ci-dessus.');
  lines.push("5. Quand pertinent, ajoute une dernière phrase d'encouragement avant la section Actions.");

  if (context.subscription) {
    const sub = context.subscription;
    lines.push(
      `Abonnement: ${sub.subscription_type || 'inconnu'} (${sub.status}). Consommation IA: ${sub.ai_consumption ?? 0} appels, seuil facturation: ${sub.billing_threshold ?? 'n/a'}.`
    );
    if (sub.current_period_end) {
      lines.push(`Fin de période en cours: ${new Date(sub.current_period_end).toLocaleDateString('fr-FR')}.`);
    }
  } else {
    lines.push("Aucun abonnement actif détecté : suggère si besoin de contacter l'équipe commerciale ou d'activer un plan adapté.");
  }

  if (context.company) {
    const location = extractLocation(context.company.address);
    lines.push(
      `Entreprise pilotée: ${context.company.name || 'Non renseignée'} (${context.company.sector || 'Secteur inconnu'}) — localisée ${location || 'localisation à compléter'}.`
    );
    if (context.company.validation_status) {
      lines.push(`Statut de validation du profil: ${context.company.validation_status}.`);
    }
    if (context.company.description) {
      lines.push(`Pitch entreprise: ${context.company.description.substring(0, 220)}${context.company.description.length > 220 ? '…' : ''}`);
    }
    if (context.company.website) {
      lines.push(`Site web public: ${context.company.website}.`);
    }
    const types = context.company.companyTypes
      ?.map((association) => association.type?.name)
      .filter(Boolean);
    if (types?.length) {
      lines.push(`Typologies déclarées: ${types.join(', ')}.`);
    }
  } else {
    lines.push("Aucune entreprise rattachée : encourage à compléter la fiche société pour personnaliser les conseils.");
  }

  if (context.usage) {
    lines.push(
      `Données disponibles dans EcoConnect → Intrants: ${context.usage.inputs}, Extrants: ${context.usage.outputs}, Analyses importées: ${context.usage.analyses}.`
    );
  }

  if (context.platform) {
    lines.push(
      `Panorama plateforme Paluds → ${context.platform.companies} entreprises connectées, ${context.platform.partners} partenaires référencés, ${context.platform.transports} transports planifiés, ${context.platform.analyses} analyses traitées, ${context.platform.suggestionEngagements} interactions partenaires engagées.`
    );
  }

  if (context.inputs?.length) {
    lines.push('Intrants récemment modifiés :');
    context.inputs.forEach((input) => {
      lines.push(
        `- ${input.name} (${input.category || 'Catégorie inconnue'}) — statut ${input.status || 'n/a'}, unité ${input.unit_measure || 'n/a'}, mis à jour le ${input.last_update ? new Date(input.last_update).toLocaleDateString('fr-FR') : 'date inconnue'}.`
      );
    });
  } else {
    lines.push("Aucun intrant récent : propose d'enregistrer les matières entrantes pour nourrir les recommandations.");
  }

  if (context.outputs?.length) {
    lines.push('Extrants récemment modifiés :');
    context.outputs.forEach((output) => {
      lines.push(
        `- ${output.name} (${output.category || 'Catégorie inconnue'}) — statut ${output.status || 'n/a'}, unité ${output.unit_measure || 'n/a'}, mis à jour le ${output.last_update ? new Date(output.last_update).toLocaleDateString('fr-FR') : 'date inconnue'}.`
      );
    });
  } else {
    lines.push("Aucun extrant récent : incite à documenter les flux sortants pour faciliter les mises en relation.");
  }

  if (context.analyses?.length) {
    lines.push('Analyses d’import récentes :');
    context.analyses.forEach((analysis, index) => {
      const precision = analysis.precision_score ? Number(analysis.precision_score) : 0;
      const revenue = analysis.financial_impact
        ? `${analysis.financial_impact.minRevenue || 0} à ${analysis.financial_impact.maxRevenue || 0} €`
        : 'n/a';
      const optimisationCount = Array.isArray(analysis.optimizations) ? analysis.optimizations.length : 0;
      lines.push(
        `- Analyse ${index + 1} (ID ${analysis.id_import_analysis}) — précision ${precision}%, potentiel ${revenue}, optimisations détectées: ${optimisationCount}.`
      );
    });
  } else {
    lines.push("Aucune analyse importée : recommande d'uploader un fichier flux pour déclencher des recommandations.");
  }

  if (context.suggestions?.length) {
    lines.push('Suggestions partenaires suivies :');
    context.suggestions.forEach((suggestion) => {
      const distance = suggestion.distance_km ? `${suggestion.distance_km.toFixed(1)} km` : 'distance inconnue';
      const reasons = Array.isArray(suggestion.reasons)
        ? suggestion.reasons
            .slice(0, 2)
            .map((reason) => {
              if (typeof reason === 'string') return reason;
              if (reason && typeof reason === 'object') {
                return reason.summary || reason.label || JSON.stringify(reason).substring(0, 80);
              }
              return String(reason);
            })
            .join(' | ')
        : null;
      lines.push(
        `- Suggestion #${suggestion.id_suggestion} — statut ${suggestion.status}, score ${suggestion.last_score ?? 'n/a'}, ${distance}${
          reasons ? `, motifs: ${reasons}` : ''
        }.`
      );
    });
  } else {
    lines.push("Aucune suggestion partenaire consultée : propose d'activer les recommandations ou de contacter l'équipe animation.");
  }

  if (context.partnerCatalog?.length) {
    lines.push('Exemples de partenaires référencés (données publiques) :');
    context.partnerCatalog.forEach((partner) => {
      lines.push(
        `- ${partner.name} — service ${partner.service_type || 'non précisé'}, zone ${partner.coverage_area || 'non précisée'}, capacité ${partner.capacity ?? 'n/a'} unités, tarif indicatif ${
          partner.rate ? `${partner.rate} €` : 'n/a'
        }, statut ${partner.status || 'non précisé'}.`
      );
    });
    lines.push("Ne divulgue jamais de coordonnées directes si elles ne sont pas fournies ; oriente vers le module Partenaires pour les détails.");
  }

  if (context.familyCatalog?.length) {
    const familyList = context.familyCatalog.map((family) => family.name).filter(Boolean);
    if (familyList.length) {
      lines.push(`Familles de matières clés disponibles sur le site : ${familyList.join(', ')}.`);
    }
  }

  lines.push('Ne jamais inventer de données qui ne figurent pas dans le contexte. Cite la source (Intrant, Extrant, Analyse, Suggestion, Abonnement) quand tu utilises une information.');
  lines.push('Si l’utilisateur demande une fonctionnalité hors périmètre EcoConnect, redirige-le vers le support ou une alternative interne.');

  return lines.join('\n');
}

async function callMistral(messages) {
  if (!MISTRAL_API_KEY) {
    throw new Error('Clé API Mistral manquante (MISTRAL_API_KEY)');
  }

  const response = await fetchFn('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 800
    })
  });

  if (response.status === 429) {
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      payload = await response.text();
    }
    const error = new Error('Capacité Mistral atteinte');
    error.code = 'LLM_CAPACITY_LIMIT';
    error.details = payload;
    error.friendlyMessage = "L'IA est momentanément saturée. Merci de réessayer dans quelques instants.";
    throw error;
  }

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`Erreur Mistral: ${response.status} ${errorPayload}`);
  }

  const payload = await response.json();
  const choice = payload?.choices?.[0];
  return {
    text: choice?.message?.content || 'Je suis désolé, je ne peux pas répondre pour le moment.',
    tokensIn: payload?.usage?.prompt_tokens || 0,
    tokensOut: payload?.usage?.completion_tokens || 0
  };
}

async function processAssistantResponse({ conversation, userMessage, assistantMessage, quickActionPrompt }) {
  try {
  const context = await fetchContext(conversation.user_id);
  const systemPrompt = buildSystemPrompt(context, conversation);

    const history = await prisma.assistantMessage.findMany({
      where: { conversation_id: conversation.id_assistant_conversation },
      orderBy: { created_at: 'asc' },
      take: 12,
      select: {
        role: true,
        text: true
      }
    });

    const mistralMessages = [
      { role: 'system', content: systemPrompt }
    ];

    history.forEach((message) => {
      if (!message.text) return;
      mistralMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.text
      });
    });

    if (quickActionPrompt) {
      mistralMessages.push({ role: 'user', content: quickActionPrompt });
    }

    mistralMessages.push({ role: 'user', content: userMessage.text });

    const result = await callMistral(mistralMessages);

    const assistantSegments = buildAssistantSegmentsFromResponse(result.text);

    const metadata = {
      ...(assistantMessage.metadata || {}),
      systemPrompt,
      presentation: {
        format: 'markdown',
        enriched: true,
        hasActions: assistantSegments.some((segment) => segment.type === 'action')
      }
    };
    if (metadata.placeholder) {
      delete metadata.placeholder;
    }

    await prisma.assistantMessage.update({
      where: { id_assistant_message: assistantMessage.id_assistant_message },
      data: {
        status: 'COMPLETED',
        text: result.text,
        content: assistantSegments,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        metadata
      }
    });

    await prisma.assistantConversation.update({
      where: { id_assistant_conversation: conversation.id_assistant_conversation },
      data: {
        last_event_at: new Date(),
        status: 'AWAITING_USER'
      }
    });

    await prisma.assistantTelemetry.create({
      data: {
        conversation_id: conversation.id_assistant_conversation,
        message_id: assistantMessage.id_assistant_message,
        user_id: conversation.user_id,
        event_type: 'assistant_response',
        data: {
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut
        }
      }
    });
  } catch (error) {
    console.error('❌ processAssistantResponse:', error);
    await prisma.assistantMessage.update({
      where: { id_assistant_message: assistantMessage.id_assistant_message },
      data: {
        status: 'ERROR',
        text: error.message,
        content: buildSegmentsFromText(error.message),
        error: error.message
      }
    });

    await prisma.assistantConversation.update({
      where: { id_assistant_conversation: conversation.id_assistant_conversation },
      data: {
        status: 'ERROR'
      }
    });

    await prisma.assistantTelemetry.create({
      data: {
        conversation_id: conversation.id_assistant_conversation,
        message_id: assistantMessage.id_assistant_message,
        user_id: conversation.user_id,
        event_type: 'assistant_error',
        data: { message: error.message }
      }
    });
  }
}

async function dispatchUserMessage({ userId, conversationId, text, quickActionId, context }) {
  if (!text || !text.trim()) {
    const error = new Error('Message vide');
    error.status = 400;
    throw error;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    const error = new Error('Message trop long (2000 caractères max).');
    error.status = 413;
    throw error;
  }

  if (hasProfanity(text)) {
    const error = new Error('Merci de reformuler votre message.');
    error.status = 400;
    throw error;
  }

  await enforceUserQuotas(userId);

  const conversation = await ensureConversation(userId, conversationId, quickActionId);

  const trimmed = text.trim();
  const userSegments = buildSegmentsFromText(trimmed);

  const userMessage = await prisma.assistantMessage.create({
    data: {
      conversation_id: conversation.id_assistant_conversation,
      user_id: userId,
      role: 'user',
      status: 'COMPLETED',
      text: trimmed,
      content: userSegments,
      metadata: context ? { context } : undefined
    }
  });

  const assistantMessage = await prisma.assistantMessage.create({
    data: {
      conversation_id: conversation.id_assistant_conversation,
      role: 'assistant',
      status: 'QUEUED',
      content: buildSegmentsFromText('Assistant en cours de réponse...'),
      metadata: {
        placeholder: true
      }
    }
  });

  await prisma.assistantConversation.update({
    where: { id_assistant_conversation: conversation.id_assistant_conversation },
    data: {
      last_event_at: new Date(),
      status: 'PROCESSING'
    }
  });

  await prisma.assistantTelemetry.create({
    data: {
      conversation_id: conversation.id_assistant_conversation,
      message_id: userMessage.id_assistant_message,
      user_id: userId,
      event_type: 'user_message',
      data: {
        length: text.length,
        quickActionId: quickActionId || null
      }
    }
  });

  const quickAction = QUICK_ACTIONS.find((item) => item.id === quickActionId);

  setImmediate(() => {
    processAssistantResponse({
      conversation,
      userMessage,
      assistantMessage,
      quickActionPrompt: quickAction?.prompt
    }).catch(async (err) => {
      console.error('❌ processAssistantResponse (async):', err);
      const friendly = err.friendlyMessage || 'Je rencontre un problème pour répondre pour le moment.';
      try {
        await prisma.assistantMessage.update({
        where: { id_assistant_message: assistantMessage.id_assistant_message },
        data: {
          status: 'ERROR',
          text: friendly,
          content: buildSegmentsFromText(friendly),
          error: err.message
        }
        });
        await prisma.assistantConversation.update({
          where: { id_assistant_conversation: conversation.id_assistant_conversation },
          data: {
            status: 'ERROR',
            last_event_at: new Date()
          }
        });
      } catch (innerErr) {
        console.error('❌ Failed to persist friendly error message:', innerErr);
      }
      await prisma.assistantTelemetry.create({
        data: {
          conversation_id: conversation.id_assistant_conversation,
          message_id: assistantMessage.id_assistant_message,
          user_id: conversation.user_id,
          event_type: 'assistant_error',
          data: {
            message: err.message,
            friendlyMessage: friendly,
            code: err.code || null
          }
        }
      }).catch((innerErr) => {
        console.error('❌ Failed to log telemetry for async error:', innerErr);
      });
    });
  });

  return { conversation, userMessage, assistantMessage };
}

async function listConversations(userId) {
  return prisma.assistantConversation.findMany({
    where: { user_id: userId },
    orderBy: { last_event_at: 'desc' },
    take: 20,
    select: {
      id_assistant_conversation: true,
      title: true,
      status: true,
      last_event_at: true,
      metadata: true
    }
  });
}

async function getConversationMessages(userId, conversationId) {
  const conversation = await assertConversationAccess(userId, conversationId);

  const messages = await prisma.assistantMessage.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'asc' }
  });

  return { conversation, messages };
}

async function getConversationUpdates(userId, conversationId, since) {
  const conversation = await assertConversationAccess(userId, conversationId);

  const filters = {
    conversation_id: conversationId
  };

  if (since) {
    filters.updated_at = { gt: since };
  }

  const messages = await prisma.assistantMessage.findMany({
    where: filters,
    orderBy: { updated_at: 'asc' }
  });

  return { conversation, messages };
}

async function assertConversationAccess(userId, conversationId) {
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id_assistant_conversation: conversationId, user_id: userId },
    select: {
      id_assistant_conversation: true,
      status: true,
      last_event_at: true,
      metadata: true,
      created_at: true
    }
  });
  if (!conversation) {
    const error = new Error('Conversation introuvable');
    error.status = 404;
    throw error;
  }
  return conversation;
}

async function escalateSupport(userId, conversationId, note) {
  await assertConversationAccess(userId, conversationId);

  const [conversation, messages] = await Promise.all([
    prisma.assistantConversation.findUnique({
      where: { id_assistant_conversation: conversationId }
    }),
    prisma.assistantMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      select: {
        role: true,
        text: true,
        created_at: true
      }
    })
  ]);

  const escalation = await prisma.assistantEscalation.create({
    data: {
      conversation_id: conversationId,
      user_id: userId,
      subject: 'Escalade support EcoConnect',
      description: note || null,
      transcript: messages,
      status: 'PENDING'
    }
  });

  const formattedTranscript = messages
    .map((msg) => `${msg.created_at.toISOString()} - ${msg.role.toUpperCase()}: ${msg.text || ''}`)
    .join('\n');

  try {
    await sendMail(
      process.env.SUPPORT_EMAIL || process.env.MAIL_USER,
      'Escalade support EcoConnect',
      `Conversation #${conversationId}\n${formattedTranscript}`,
      `<h2>Conversation #${conversationId}</h2><pre>${formattedTranscript}</pre>`
    );

    await prisma.assistantEscalation.update({
      where: { id_assistant_escalation: escalation.id_assistant_escalation },
      data: {
        status: 'SENT'
      }
    });
  } catch (error) {
    console.error('❌ Envoi email escalade:', error);
  }

  await prisma.assistantTelemetry.create({
    data: {
      conversation_id: conversationId,
      message_id: null,
      user_id: userId,
      event_type: 'escalation_created'
    }
  });

  return escalation;
}

async function enforceUserQuotas(userId) {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const burstAgo = new Date(now - BURST_WINDOW_MS);

  const [dailyCount, burstCount] = await Promise.all([
    prisma.assistantTelemetry.count({
      where: {
        user_id: userId,
        event_type: 'user_message',
        created_at: { gte: dayAgo }
      }
    }),
    prisma.assistantTelemetry.count({
      where: {
        user_id: userId,
        event_type: 'user_message',
        created_at: { gte: burstAgo }
      }
    })
  ]);

  if (dailyCount >= MAX_DAILY_USER_MESSAGES) {
    const error = new Error('Limite quotidienne atteinte. Réessayez demain ou contactez le support.');
    error.status = 429;
    throw error;
  }

  if (burstCount >= MAX_BURST_MESSAGES) {
    const error = new Error('Vous envoyez des messages trop rapidement. Patientez quelques secondes.');
    error.status = 429;
    throw error;
  }
}

function extractLocation(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const postcodeMatch = trimmed.match(/(\d{4,5})\s+([^,]+)/);
  if (postcodeMatch) {
    const [, postal, city] = postcodeMatch;
    return `${city.trim()} (${postal})`;
  }

  const segments = trimmed.split(',').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length >= 2) {
    return segments.slice(-2).join(', ');
  }

  return segments[0] || trimmed;
}

function buildSegmentsFromText(text) {
  if (!text) return [];
  return [
    {
      type: TEXT_SEGMENT_TYPE,
      text
    }
  ];
}

function buildAssistantSegmentsFromResponse(text) {
  if (!text) {
    return [];
  }

  const segments = [];
  const lines = String(text).split(/\r?\n/);
  let paragraphAccumulator = [];

  const flushParagraph = () => {
    if (paragraphAccumulator.length) {
      segments.push({
        type: 'paragraph',
        text: paragraphAccumulator.join(' ').trim()
      });
      paragraphAccumulator = [];
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      segments.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      return;
    }

    const numberedMatch = line.match(/^(\d+)[\.)]\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      segments.push({
        type: 'list_item',
        style: 'numbered',
        order: Number.parseInt(numberedMatch[1], 10),
        text: numberedMatch[2].trim()
      });
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const bulletContent = bulletMatch[1].trim();
      const actionMatch = bulletContent.match(/^\[(.+?)\]\(route:([^\)\s]+)\)(?:\s*[-–—]\s*(.+))?$/i);
      if (actionMatch) {
        flushParagraph();
        const label = actionMatch[1].trim();
        const routeKeyOrPath = actionMatch[2].trim();
        const description = actionMatch[3] ? actionMatch[3].trim() : undefined;
        let route = NAVIGATION_ROUTES[routeKeyOrPath];
        if (!route) {
          route = routeKeyOrPath.startsWith('/') ? routeKeyOrPath : `/${routeKeyOrPath}`;
        }
        segments.push({
          type: 'action',
          label,
          route,
          ...(description ? { description } : {})
        });
        return;
      }

      flushParagraph();
      segments.push({
        type: 'list_item',
        style: 'bullet',
        text: bulletContent
      });
      return;
    }

    paragraphAccumulator.push(line);
  });

  flushParagraph();

  if (!segments.length) {
    return buildSegmentsFromText(text);
  }

  return segments;
}

module.exports = {
  QUICK_ACTIONS,
  createConversation,
  dispatchUserMessage,
  listConversations,
  getConversationMessages,
  getConversationUpdates,
  escalateSupport
};
