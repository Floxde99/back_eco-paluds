const { z } = require('zod');
const logger = require('../services/logger');
const {
  MessagingError,
  createContact,
  listContacts,
  getConversation,
  sendCompanyMessage,
  markMessageRead,
  markConversationRead
} = require('../services/messagingService');

const paginationSchema = z.object({
  page: z.preprocess((val) => Number(val ?? 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => Number(val ?? 20), z.number().int().min(1).max(50)).optional(),
  search: z.string().trim().min(1).optional()
});

const conversationIdentifierSchema = z.object({
  companyId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional(),
  conversationId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional()
}).superRefine((data, ctx) => {
  if (!data.companyId && !data.conversationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'companyId ou conversationId requis',
      path: ['conversationId']
    });
  }
});

const conversationQuerySchema = z.object({
  limit: z.preprocess((val) => Number(val ?? 50), z.number().int().min(1).max(200)).optional(),
  after: z.string().datetime().optional()
});

const sendMessageSchema = z.object({
  companyId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional(),
  conversationId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional(),
  recipientId: z.number().int().positive().optional(),
  body: z.string().trim().min(1),
  attachments: z.array(z.union([z.string().trim(), z.record(z.any())])).optional()
}).superRefine((data, ctx) => {
  if (!data.companyId && !data.conversationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'companyId ou conversationId requis',
      path: ['conversationId']
    });
  }
});

const markMessageReadSchema = z.object({
  messageId: z.number().int().positive()
});

const markConversationReadSchema = z.object({
  companyId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional(),
  conversationId: z.preprocess((val) => (val === undefined || val === null || val === '' ? undefined : Number(val)), z.number().int().positive()).optional()
}).superRefine((data, ctx) => {
  if (!data.companyId && !data.conversationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'companyId ou conversationId requis',
      path: ['conversationId']
    });
  }
});

const createContactSchema = z.object({
  companyId: z.number().int().positive()
});

const sendError = (res, error) => {
  if (error instanceof MessagingError) {
    return res.status(error.status).json({
      success: false,
      error: error.message,
      details: error.details || null
    });
  }
  logger.error('Messaging controller error', { error: error.message });
  return res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur'
  });
};

exports.getContacts = async (req, res) => {
  try {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres de pagination invalides',
        details: parsed.error.flatten()
      });
    }

    const payload = await listContacts({
      userId: req.user.userId,
      page: parsed.data.page,
      limit: parsed.data.limit,
      search: parsed.data.search
    });

    res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createContact = async (req, res) => {
  try {
    const parsed = createContactSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Payload invalide',
        details: parsed.error.flatten()
      });
    }

    const payload = await createContact({
      userId: req.user.userId,
      companyId: parsed.data.companyId
    });

    res.status(201).json({
      success: true,
      data: payload
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getMessages = async (req, res) => {
  try {
    const conversationIdParam = Number(req.params.conversationId);
    const identifierInput = {
      conversationId: Number.isNaN(conversationIdParam) ? undefined : conversationIdParam,
      companyId: req.query.companyId ? Number(req.query.companyId) : undefined
    };
    const parsedIdentifier = conversationIdentifierSchema.safeParse(identifierInput);
    if (!parsedIdentifier.success) {
      return res.status(400).json({
        success: false,
        error: 'Identifiants conversation/entreprise invalides',
        details: parsedIdentifier.error.flatten()
      });
    }

    const parsedQuery = conversationQuerySchema.safeParse({
      limit: req.query.limit,
      after: req.query.after
    });
    if (!parsedQuery.success) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres de requête invalides',
        details: parsedQuery.error.flatten()
      });
    }

    const payload = await getConversation({
      userId: req.user.userId,
      companyId: parsedIdentifier.data.companyId,
      conversationId: parsedIdentifier.data.conversationId,
      limit: parsedQuery.data.limit,
      after: parsedQuery.data.after
    });

    res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.postMessage = async (req, res) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Payload invalide',
        details: parsed.error.flatten()
      });
    }

    const message = await sendCompanyMessage({
      userId: req.user.userId,
      companyId: parsed.data.companyId,
      conversationId: parsed.data.conversationId,
      body: parsed.data.body,
      attachments: parsed.data.attachments,
      recipientId: parsed.data.recipientId
    });

    res.status(201).json({
      success: true,
      data: message
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markMessageRead = async (req, res) => {
  try {
    const parsed = markMessageReadSchema.safeParse({
      messageId: Number(req.params.messageId)
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Identifiant message invalide',
        details: parsed.error.flatten()
      });
    }

    const payload = await markMessageRead({
      userId: req.user.userId,
      messageId: parsed.data.messageId
    });

    res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markConversationRead = async (req, res) => {
  try {
    const conversationIdParam = Number(req.params.conversationId);
    const identifierInput = {
      conversationId: Number.isNaN(conversationIdParam) ? undefined : conversationIdParam,
      companyId: req.body?.companyId
        ? Number(req.body.companyId)
        : req.query?.companyId
          ? Number(req.query.companyId)
          : undefined
    };

    const parsed = markConversationReadSchema.safeParse(identifierInput);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Identifiant entreprise invalide',
        details: parsed.error.flatten()
      });
    }

    const payload = await markConversationRead({
      userId: req.user.userId,
      companyId: parsed.data.companyId,
      conversationId: parsed.data.conversationId
    });

    res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    return sendError(res, error);
  }
};
