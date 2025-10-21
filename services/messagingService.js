const { PrismaClient } = require('../generated/prisma/client');
const { sendMail } = require('./mailer');
const { randomUUID } = require('crypto');

const prisma = new PrismaClient();

const companySummarySelect = {
  id_company: true,
  name: true,
  sector: true,
  address: true,
  website: true,
  phone: true,
  email: true,
  validation_status: true,
  owner_id: true
};

const DAILY_MESSAGE_LIMIT = Number.parseInt(process.env.COMPANY_MESSAGING_DAILY_LIMIT || '200', 10);
const MESSAGE_PREVIEW_LENGTH = 220;

class MessagingError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const buildMessageDto = (message) => ({
  id: message.id_company_message,
  traceId: message.trace_id,
  conversationId: message.conversation_id,
  companyId: message.company_id,
  senderId: message.sender_id,
  recipientId: message.recipient_id,
  body: message.body,
  attachments: message.attachments || [],
  status: message.status,
  createdAt: message.created_at,
  updatedAt: message.updated_at
});

const buildConversationDto = (conversation, company) => ({
  id: conversation.id_company_conversation,
  companyId: conversation.company_id,
  status: conversation.status,
  lastMessageAt: conversation.last_message_at,
  lastMessagePreview: conversation.last_message_preview,
  unreadCount: conversation.unread_count,
  createdAt: conversation.created_at,
  updatedAt: conversation.updated_at,
  company: company
    ? {
        id: company.id_company,
        name: company.name,
        sector: company.sector,
        address: company.address,
        website: company.website,
        phone: company.phone,
        email: company.email,
        validationStatus: company.validation_status
      }
    : undefined
});

const sanitizeAttachments = (attachments) => {
  if (!attachments) {
    return undefined;
  }
  if (!Array.isArray(attachments)) {
    throw new MessagingError(400, 'Format pièces jointes invalide');
  }
  return attachments
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === 'string') {
        return item;
      }
      if (typeof item === 'object') {
        const clone = { ...item };
        return clone;
      }
      return null;
    })
    .filter(Boolean);
};

const enforceDailyLimit = async (userId) => {
  if (!DAILY_MESSAGE_LIMIT || DAILY_MESSAGE_LIMIT <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.companyMessage.count({
    where: {
      sender_id: userId,
      created_at: { gte: cutoff }
    }
  });
  if (count >= DAILY_MESSAGE_LIMIT) {
    throw new MessagingError(429, 'Limite de messages quotidienne atteinte. Merci de réessayer demain.');
  }
};

const resolveCompanyAndContact = async ({ userId, companyId, recipientId }) => {
  const company = await prisma.company.findUnique({
    where: { id_company: companyId },
    select: {
      ...companySummarySelect,
      owner_id: true
    }
  });

  if (!company) {
    throw new MessagingError(404, 'Entreprise introuvable');
  }

  const contactUserId = recipientId && recipientId !== userId ? recipientId : userId;

  let contact = await prisma.companyContact.findFirst({
    where: {
      user_id: contactUserId,
      company_id: companyId
    }
  });

  if (!contact) {
    if (company.owner_id === contactUserId) {
      contact = await prisma.companyContact.create({
        data: {
          user_id: contactUserId,
          company_id: companyId,
          status: 'active'
        }
      });
    } else {
      throw new MessagingError(403, 'Aucune relation active avec cette entreprise');
    }
  }

  if (contact.status !== 'active') {
    throw new MessagingError(403, 'Relation inactive ou bloquée');
  }

  if (contact.user_id !== userId && company.owner_id !== userId) {
    throw new MessagingError(403, 'Accès refusé à cette conversation');
  }

  return { company, contact, conversationUserId: contact.user_id };
};

const getOrCreateConversation = async ({ conversationUserId, companyId, contact }) => {
  const existing = await prisma.companyConversation.findUnique({
    where: {
      user_id_company_id: {
        user_id: conversationUserId,
        company_id: companyId
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.companyConversation.create({
    data: {
      contact_id: contact.id_company_contact,
      user_id: conversationUserId,
      company_id: companyId,
      status: 'active',
      last_message_at: null,
      last_message_preview: null
    }
  });
};

const getConversationWithContext = async (conversationId) =>
  prisma.companyConversation.findFirst({
    where: { id_company_conversation: conversationId },
    include: {
      company: { select: companySummarySelect },
      contact: true
    }
  });

const getConversationWithContextByUser = async ({ conversationUserId, companyId }) =>
  prisma.companyConversation.findUnique({
    where: {
      user_id_company_id: {
        user_id: conversationUserId,
        company_id: companyId
      }
    },
    include: {
      company: { select: companySummarySelect },
      contact: true
    }
  });

const getConversationContext = async ({
  userId,
  companyId,
  conversationId,
  recipientId,
  createIfMissing = true
}) => {
  if (conversationId) {
    const conversation = await getConversationWithContext(conversationId);
    if (!conversation) {
      throw new MessagingError(404, 'Conversation introuvable');
    }
    if (conversation.user_id !== userId) {
      throw new MessagingError(403, 'Accès refusé à cette conversation');
    }
    return {
      company: conversation.company,
      contact: conversation.contact,
      conversation,
      conversationUserId: conversation.user_id
    };
  }

  if (!companyId) {
    throw new MessagingError(400, 'companyId ou conversationId requis');
  }

  const { company, contact, conversationUserId } = await resolveCompanyAndContact({
    userId,
    companyId,
    recipientId
  });

  let conversation = await getConversationWithContextByUser({
    conversationUserId,
    companyId
  });

  if (!conversation) {
    if (!createIfMissing) {
      throw new MessagingError(404, 'Conversation introuvable');
    }
    const created = await prisma.companyConversation.create({
      data: {
        contact_id: contact.id_company_contact,
        user_id: conversationUserId,
        company_id: companyId,
        status: 'active'
      },
      include: {
        company: { select: companySummarySelect },
        contact: true
      }
    });
    conversation = created;
  }

  return { company, contact, conversation, conversationUserId };
};

const listContacts = async ({ userId, page = 1, limit = 20, search }) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filters = {
    user_id: userId,
    status: 'active'
  };

  if (search && search.trim()) {
    filters['company'] = {
      OR: [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { sector: { contains: search.trim(), mode: 'insensitive' } }
      ]
    };
  }

  const [contacts, total] = await Promise.all([
    prisma.companyConversation.findMany({
      where: {
        user_id: userId,
        status: 'active',
        contact: {
          status: 'active',
          ...(filters.company ? { company: filters.company } : {})
        }
      },
      include: {
        company: {
          select: {
            id_company: true,
            name: true,
            sector: true,
            address: true,
            website: true,
            phone: true,
            email: true,
            validation_status: true
          }
        }
      },
      orderBy: [
        { last_message_at: 'desc' },
        { updated_at: 'desc' }
      ],
      skip,
      take: safeLimit
    }),
    prisma.companyConversation.count({
      where: {
        user_id: userId,
        status: 'active',
        contact: {
          status: 'active',
          ...(filters.company ? { company: filters.company } : {})
        }
      }
    })
  ]);

  return {
    items: contacts.map((conversation) => buildConversationDto(conversation, conversation.company)),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit)
    }
  };
};

const getConversation = async ({ userId, companyId, conversationId, limit = 50, after }) => {
  const { company, conversation } = await getConversationContext({
    userId,
    companyId,
    conversationId,
    createIfMissing: true
  });

  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const dateFilter = after ? new Date(after) : null;
  if (after && Number.isNaN(dateFilter?.getTime())) {
    throw new MessagingError(400, 'Paramètre after invalide');
  }

  const whereClause = {
    conversation_id: conversation.id_company_conversation
  };
  if (dateFilter) {
    whereClause.created_at = { gt: dateFilter };
  }

  const messages = await prisma.companyMessage.findMany({
    where: whereClause,
    orderBy: { created_at: 'asc' },
    take: safeLimit
  });

  const companyInfo = conversation.company || company;

  return {
    company: {
      id: companyInfo.id_company,
      name: companyInfo.name,
      sector: companyInfo.sector,
      address: companyInfo.address,
      website: companyInfo.website,
      phone: companyInfo.phone,
      email: companyInfo.email,
      validationStatus: companyInfo.validation_status
    },
    conversation: buildConversationDto(conversation, companyInfo),
    messages: messages.map(buildMessageDto)
  };
};

const createContact = async ({ userId, companyId }) => {
  const company = await prisma.company.findUnique({
    where: { id_company: companyId },
    select: companySummarySelect
  });

  if (!company) {
    throw new MessagingError(404, 'Entreprise introuvable');
  }

  let contact = await prisma.companyContact.findFirst({
    where: {
      user_id: userId,
      company_id: companyId
    }
  });

  if (contact) {
    if (contact.status === 'blocked') {
      throw new MessagingError(403, 'Relation bloquée');
    }

    if (contact.status !== 'active') {
      contact = await prisma.companyContact.update({
        where: { id_company_contact: contact.id_company_contact },
        data: {
          status: 'active'
        }
      });
    }
  } else {
    contact = await prisma.companyContact.create({
      data: {
        user_id: userId,
        company_id: companyId,
        status: 'active'
      }
    });
  }

  const { conversation } = await getConversationContext({
    userId,
    companyId,
    conversationId: undefined,
    createIfMissing: true
  });

  const companyInfo = conversation.company || company;

  return {
    contact: {
      id: contact.id_company_contact,
      status: contact.status,
      createdAt: contact.created_at,
      updatedAt: contact.updated_at
    },
    conversation: buildConversationDto(conversation, companyInfo)
  };
};

const notifyRecipient = async ({ message, company, senderId, recipientId }) => {
  try {
    let targetUserId = recipientId;
    if (!targetUserId) {
      const companyOwnerId = company.owner_id;
      if (companyOwnerId && companyOwnerId !== senderId) {
        targetUserId = companyOwnerId;
      }
    }

    if (!targetUserId) {
      return;
    }

    const recipient = await prisma.user.findUnique({
      where: { id_user: targetUserId },
      select: { email: true, first_name: true, last_name: true }
    });

    if (!recipient || !recipient.email) {
      return;
    }

    const sender = await prisma.user.findUnique({
      where: { id_user: senderId },
      select: { first_name: true, last_name: true, email: true }
    });

    const subject = `Nouveau message EcoConnect – ${company.name}`;
    const senderLabel = sender
      ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim() || sender.email || 'Un contact EcoConnect'
      : 'Un contact EcoConnect';

    const preview = message.body.length > 180 ? `${message.body.slice(0, 177).trim()}…` : message.body;

    const textContent = [
      `Vous avez reçu un nouveau message concernant ${company.name}.`,
      '',
      `Expéditeur : ${senderLabel}`,
      '',
      'Message :',
      preview,
      '',
      'Connectez-vous à EcoConnect pour répondre.'
    ].join('\n');

    const htmlContent = `
      <p>Vous avez reçu un nouveau message concernant <strong>${company.name}</strong>.</p>
      <p><strong>Expéditeur :</strong> ${senderLabel}</p>
      <p><strong>Message :</strong><br/>${preview}</p>
      <p><a href="${process.env.FRONTEND_BASE_URL || 'https://app.eco-paluds.fr'}/contacts/messages?company=${company.id_company}">Ouvrir la conversation</a></p>
    `;

    await sendMail(recipient.email, subject, textContent, htmlContent);
  } catch (error) {
    console.error('❌ Notification message échouée:', error);
  }
};

const sendCompanyMessage = async ({ userId, companyId, conversationId, body, attachments, recipientId }) => {
  if (!body || !body.trim()) {
    throw new MessagingError(400, 'Message vide');
  }

  await enforceDailyLimit(userId);

  const { company, conversation, conversationUserId } = await getConversationContext({
    userId,
    companyId,
    conversationId,
    recipientId,
    createIfMissing: true
  });

  const normalizedAttachments = sanitizeAttachments(attachments);
  const traceId = randomUUID();

  const message = await prisma.companyMessage.create({
    data: {
      conversation_id: conversation.id_company_conversation,
      company_id: conversation.company_id,
      sender_id: userId,
      recipient_id: recipientId || company.owner_id || null,
      body: body.trim(),
      attachments: normalizedAttachments,
      status: 'sent',
      trace_id: traceId
    }
  });

  const preview = message.body.length > MESSAGE_PREVIEW_LENGTH
    ? `${message.body.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trim()}…`
    : message.body;

  await prisma.companyConversation.update({
    where: { id_company_conversation: conversation.id_company_conversation },
    data: {
      last_message_at: message.created_at,
      last_message_preview: preview,
      updated_at: new Date(),
      ...(message.sender_id === conversationUserId
        ? { unread_count: 0 }
        : message.recipient_id === conversationUserId && message.recipient_id !== message.sender_id
          ? { unread_count: { increment: 1 } }
          : {})
    }
  });

  const companyInfo = conversation.company || company;

  await notifyRecipient({ message, company: companyInfo, senderId: userId, recipientId: message.recipient_id });

  return buildMessageDto(message);
};

const markMessageRead = async ({ userId, messageId }) => {
  const message = await prisma.companyMessage.findUnique({
    where: { id_company_message: messageId },
    select: {
      id_company_message: true,
      conversation_id: true,
      recipient_id: true,
      status: true,
      company_id: true
    }
  });

  if (!message) {
    throw new MessagingError(404, 'Message introuvable');
  }

  if (message.recipient_id !== userId) {
    throw new MessagingError(403, 'Accès refusé à ce message');
  }

  if (message.status === 'read') {
    return message;
  }

  await prisma.companyMessage.update({
    where: { id_company_message: messageId },
    data: {
      status: 'read',
      updated_at: new Date()
    }
  });

  await prisma.companyConversation.update({
    where: { id_company_conversation: message.conversation_id },
    data: {
      unread_count: {
        decrement: 1
      }
    }
  }).catch(() => {
    /* ignore decrement floor errors */
  });

  return {
    id: message.id_company_message,
    status: 'read'
  };
};

const markConversationRead = async ({ userId, companyId, conversationId }) => {
  const { conversation } = await getConversationContext({
    userId,
    companyId,
    conversationId,
    createIfMissing: false
  });

  await prisma.$transaction([
    prisma.companyMessage.updateMany({
      where: {
        conversation_id: conversation.id_company_conversation,
        recipient_id: userId,
        status: { not: 'read' }
      },
      data: {
        status: 'read',
        updated_at: new Date()
      }
    }),
    prisma.companyConversation.update({
      where: { id_company_conversation: conversation.id_company_conversation },
      data: {
        unread_count: 0
      }
    })
  ]);

  return {
    conversationId: conversation.id_company_conversation,
    companyId: conversation.company_id,
    unreadCount: 0
  };
};

module.exports = {
  MessagingError,
  createContact,
  listContacts,
  getConversation,
  sendCompanyMessage,
  markMessageRead,
  markConversationRead
};
