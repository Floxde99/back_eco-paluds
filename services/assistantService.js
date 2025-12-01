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
    familyCatalog,
    platformSnapshot,
    usageCounts
  ] = await Promise.all([
    recentImportsPromise,
    recentInputsPromise,
    recentOutputsPromise,
    suggestionInteractionsPromise,
    subscriptionPromise,
    familyCatalogPromise,
    platformSnapshotPromise,
    usageCountsPromise
  ]);

  const [inputCount, outputCount, analysisCount] = usageCounts || [0, 0, 0];
  const [companyCount, analysisTotalCount, suggestionEngagementCount] =
    platformSnapshot || [0, 0, 0];

  return {
    company,
    analyses: recentImports,
    inputs: recentInputs,
    outputs: recentOutputs,
    suggestions,
    subscription,
    familyCatalog,
    platform: {
      companies: companyCount,
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

  const routesList = Object.entries(NAVIGATION_ROUTES)
    .map(([key, path]) => `${key}: ${path}`)
    .join(' | ');

  const lines = [
    "Tu es l'assistant IA d'EcoConnect Paluds (économie circulaire).",
    'Réponds uniquement en français, ton expert mais concis, orienté action.',
    "Ton rôle: guider l’utilisateur dans l’app (analyses d’import, intrants/extrants, suggestions de partenaires, abonnement, profil).",
    `Routes disponibles pour tes boutons: ${routesList}. N’utilise que ces routes.`,
    'Formate tes boutons/actions en puces : "- [Libellé](route:cleOuChemin) --- courte explication".',
    'Structure attendue : 1) Synthèse brève 2) Recommandations numérotées 3) Section "Actions" avec 1-3 boutons formatés ci-dessus.',
    'Si une donnée manque, dis-le puis propose comment la collecter dans EcoConnect (import, fiche intrant/extrant, profil, suggestion).',
    'Signale contraintes/limites si nécessaire et reste factuel (ne pas inventer).'
  ];

  if (quickActionMetadata) {
    lines.push(`Priorité Quick Action: ${quickActionMetadata.label} (${quickActionMetadata.prompt}).`);
  }

  if (context?.subscription) {
    const sub = context.subscription;
    lines.push(
      `Abonnement: ${sub.subscription_type || 'inconnu'} (${sub.status}). Conso IA: ${sub.ai_consumption ?? 0}, seuil facturation: ${sub.billing_threshold ?? 'n/a'}.`
    );
  }

  if (context?.company) {
    const c = context.company;
    const location = extractLocation(c.address);
    lines.push(
      `Entreprise: ${c.name || 'Non renseignée'} | secteur: ${c.sector || 'n/a'} | localisation: ${location || 'n/a'} | statut profil: ${c.validation_status || 'n/a'}.`
    );
    if (c.description) {
      lines.push(`Pitch: ${c.description.substring(0, 200)}${c.description.length > 200 ? '...' : ''}`);
    }
  }

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
