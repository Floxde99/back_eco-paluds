const { z } = require('zod');
const {
  QUICK_ACTIONS,
  createConversation,
  dispatchUserMessage,
  listConversations,
  getConversationMessages,
  getConversationUpdates,
  escalateSupport
} = require('../services/assistantService');

const createConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  quickActionId: z.string().optional(),
  context: z.record(z.any()).optional()
});

const postMessageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  message: z.string().min(1),
  quickActionId: z.string().optional(),
  context: z.record(z.any()).optional()
});

const escalationSchema = z.object({
  conversationId: z.number().int().positive(),
  note: z.string().max(500).optional()
});

function buildConversationDto(item, overrides = {}) {
  const merged = { ...item, ...overrides };
  return {
    id: merged.id_assistant_conversation,
    title: merged.title,
    status: merged.status,
    statusNormalized: merged.status ? String(merged.status).toLowerCase() : null,
    lastEventAt: merged.last_event_at,
    createdAt: merged.created_at,
    metadata: merged.metadata || null
  };
}

function toMessageDto(message) {
  const content = normalizeContent(message);
  return {
    id: message.id_assistant_message,
    role: message.role,
    status: message.status,
    text: message.text,
    content,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    metadata: message.metadata,
    error: message.error,
    tokensIn: message.tokens_in || 0,
    tokensOut: message.tokens_out || 0
  };
}

function normalizeContent(message) {
  if (!message) return [];

  const { content, text } = message;

  if (Array.isArray(content) && content.length) {
    return content;
  }

  if (typeof content === 'string' && content.trim().length) {
    return [{ type: 'text', text: content.trim() }];
  }

  if (content && typeof content === 'object' && Object.keys(content).length) {
    if (content.text) {
      return [{ type: 'text', text: String(content.text) }];
    }
    if (content.value) {
      return [{ type: 'text', text: String(content.value) }];
    }
  }

  if (text && text.trim().length) {
    return [{ type: 'text', text: text.trim() }];
  }

  return [];
}

exports.getTemplates = (req, res) => {
  res.status(200).json({ success: true, data: QUICK_ACTIONS });
};

exports.listConversations = async (req, res) => {
  try {
    const conversations = await listConversations(req.user.userId);
    res.status(200).json({
      success: true,
      data: conversations.map((conversation) => buildConversationDto(conversation))
    });
  } catch (error) {
    console.error('❌ listConversations:', error);
    res.status(500).json({ error: 'Impossible de récupérer les conversations.' });
  }
};

exports.createConversation = async (req, res) => {
  try {
    const parsed = createConversationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
    }

  const conversation = await createConversation(req.user.userId, parsed.data);
  res.status(201).json({ success: true, data: buildConversationDto(conversation) });
  } catch (error) {
    console.error('❌ createConversation:', error);
    res.status(error.status || 500).json({ error: error.message || 'Erreur création conversation.' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(conversationId)) {
      return res.status(400).json({ error: 'Identifiant conversation invalide.' });
    }
    const { conversation, messages } = await getConversationMessages(req.user.userId, conversationId);
    res.status(200).json({
      success: true,
      data: {
  conversation: buildConversationDto(conversation),
        messages: messages.map(toMessageDto)
      }
    });
  } catch (error) {
    console.error('❌ getMessages:', error);
    res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer les messages.' });
  }
};

exports.getUpdates = async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(conversationId)) {
      return res.status(400).json({ error: 'Identifiant conversation invalide.' });
    }

    const since = req.query.since ? new Date(req.query.since) : undefined;
    if (req.query.since && Number.isNaN(since?.getTime())) {
      return res.status(400).json({ error: 'Paramètre since invalide.' });
    }

    const { conversation, messages } = await getConversationUpdates(req.user.userId, conversationId, since);
    res.status(200).json({
      success: true,
      data: {
  conversation: buildConversationDto(conversation),
        status: conversation.status,
        statusNormalized: conversation.status ? String(conversation.status).toLowerCase() : null,
        messages: messages.map(toMessageDto)
      }
    });
  } catch (error) {
    console.error('❌ getUpdates:', error);
    res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer les mises à jour.' });
  }
};

exports.postMessage = async (req, res) => {
  try {
    const parsed = postMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
    }

    const { conversation, userMessage, assistantMessage } = await dispatchUserMessage({
      userId: req.user.userId,
      conversationId: parsed.data.conversationId,
      text: parsed.data.message,
      quickActionId: parsed.data.quickActionId,
      context: parsed.data.context
    });

    const conversationDto = buildConversationDto(conversation, {
      status: 'PROCESSING',
      last_event_at: new Date()
    });

    res.status(202).json({
      success: true,
      data: {
        conversation: conversationDto,
        userMessage: toMessageDto(userMessage),
        assistantMessage: toMessageDto(assistantMessage)
      }
    });
  } catch (error) {
    console.error('❌ postMessage:', error);
    res.status(error.status || 500).json({ error: error.message || 'Impossible d\'envoyer le message.' });
  }
};

exports.createEscalation = async (req, res) => {
  try {
    const parsed = escalationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
    }

    const escalation = await escalateSupport(req.user.userId, parsed.data.conversationId, parsed.data.note);
    res.status(201).json({ success: true, data: escalation });
  } catch (error) {
    console.error('❌ createEscalation:', error);
    res.status(error.status || 500).json({ error: error.message || 'Impossible de créer une escalade.' });
  }
};
