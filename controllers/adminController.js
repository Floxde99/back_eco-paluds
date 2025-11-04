const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();
const { z } = require('zod');
const {
  normalizeArrayParam,
  parseIntegerParam,
  parseNumberParam
} = require('../lib/params');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const ACTIVE_STATUSES = new Set(['active', 'validated', 'approved']);
const CRITICAL_STATUSES = new Set(['flagged', 'blocked', 'suspended', 'rejected']);

const companyCreateSchema = z.object({
  name: z.string().min(2).max(255),
  sector: z.string().min(2).max(255),
  address: z.string().min(2).max(255).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: z.string().url().optional().nullable(),
  siret: z.string().min(9).max(20),
  validationStatus: z.string().optional(),
  ownerId: z.number().int().positive().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable()
});

const companyUpdateSchema = companyCreateSchema.partial().extend({
  validationStatus: z.string().optional()
});

const statusUpdateSchema = z.object({
  status: z.string().min(1),
  reason: z.string().max(500).optional()
});

const buildDate = (date) => (date instanceof Date ? date : new Date(date));

const computePercentageChange = (current, previous) => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);

const buildMonthlyBuckets = (months, fromDate = new Date()) => {
  const buckets = [];
  const currentMonthStart = startOfMonth(fromDate);

  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - i, 1);
    const end = endOfMonth(start);
    buckets.push({
      label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      start,
      end,
      total: 0
    });
  }

  return buckets;
};

const normaliseCompanyFilters = (query) => {
  const where = {};
  const statuses = normalizeArrayParam(query.status || query.statuses);
  const sectors = normalizeArrayParam(query.sector || query.sectors);
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  if (statuses.length) {
    where.validation_status = { in: statuses };
  }

  if (sectors.length) {
    where.sector = { in: sectors };
  }

  if (search) {
    const searchFilter = {
      contains: search,
      mode: 'insensitive'
    };

    where.OR = [
      { name: searchFilter },
      { email: searchFilter },
      { phone: searchFilter },
      { siret: searchFilter },
      { sector: searchFilter },
      { owner: { first_name: searchFilter } },
      { owner: { last_name: searchFilter } }
    ];
  }

  return where;
};

const baseCompanySelect = {
  id_company: true,
  name: true,
  sector: true,
  validation_status: true,
  creation_date: true,
  last_update: true,
  email: true,
  phone: true,
  website: true,
  address: true,
  siret: true,
  owner: {
    select: {
      id_user: true,
      first_name: true,
      last_name: true,
      email: true
    }
  },
  _count: {
    select: {
      inputs: true,
      outputs: true
    }
  }
};

exports.getDashboardMetrics = async (req, res) => {
  try {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prevMonth = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeek = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const completionConditions = [
      { description: { not: null } },
      { description: { not: '' } },
      { phone: { not: '' } },
      { email: { not: '' } },
      { address: { not: '' } }
    ];

    const [
      totalCompanies,
      companiesLastMonth,
      companiesPrevMonth,
      totalConnections,
      connectionsLastWeek,
      connectionsPrevWeek,
      companiesWithProfiles,
      companiesProfilePrev,
      pendingModeration,
      criticalModeration
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { creation_date: { gte: monthAgo } } }),
      prisma.company.count({
        where: {
          creation_date: {
            gte: prevMonth,
            lt: monthAgo
          }
        }
      }),
      prisma.companyConversation.count(),
      prisma.companyConversation.count({ where: { created_at: { gte: weekAgo } } }),
      prisma.companyConversation.count({
        where: {
          created_at: {
            gte: prevWeek,
            lt: weekAgo
          }
        }
      }),
      prisma.company.count({
        where: { AND: completionConditions }
      }),
      prisma.company.count({
        where: {
          AND: [
            ...completionConditions,
            { last_update: { gte: prevMonth, lt: monthAgo } }
          ]
        }
      }),
      prisma.company.count({
        where: {
          validation_status: { notIn: Array.from(ACTIVE_STATUSES) }
        }
      }),
      prisma.company.count({
        where: {
          validation_status: { in: Array.from(CRITICAL_STATUSES) }
        }
      })
    ]);

    const completionRate = totalCompanies === 0 ? 0 : (companiesWithProfiles / totalCompanies) * 100;
    const previousCompletionRate = totalCompanies === 0 ? 0 : (companiesProfilePrev / totalCompanies) * 100;

    return res.status(200).json({
      companies: {
        total: totalCompanies,
        createdLastMonth: companiesLastMonth,
        changeRate: computePercentageChange(companiesLastMonth, companiesPrevMonth)
      },
      connections: {
        total: totalConnections,
        createdLastWeek: connectionsLastWeek,
        changeRate: computePercentageChange(connectionsLastWeek, connectionsPrevWeek)
      },
      activity: {
        completionRate: Math.round(completionRate * 10) / 10,
        changeRate: Math.round((completionRate - previousCompletionRate) * 10) / 10,
        companiesWithProfile: companiesWithProfiles
      },
      moderation: {
        pending: pendingModeration,
        critical: criticalModeration
      }
    });
  } catch (error) {
    console.error('? getDashboardMetrics:', error);
    return res.status(500).json({ error: 'Impossible de charger les métriques administrateur.' });
  }
};

exports.listCompanies = async (req, res) => {
  try {
    const page = Math.max(parseIntegerParam(req.query.page) || DEFAULT_PAGE, 1);
    const pageSizeRaw = parseIntegerParam(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), MAX_PAGE_SIZE);
    const where = normaliseCompanyFilters(req.query);

    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'creation_date';
    const sortDir = (typeof req.query.sortOrder === 'string' ? req.query.sortOrder.toLowerCase() : 'desc') === 'asc' ? 'asc' : 'desc';

    const orderByMap = {
      name: { name: sortDir },
      sector: { sector: sortDir },
      status: { validation_status: sortDir },
      updatedAt: { last_update: sortDir },
      creation_date: { creation_date: sortDir }
    };

    const orderBy = orderByMap[sortBy] || orderByMap.creation_date;

    const [total, companies] = await Promise.all([
      prisma.company.count({ where }),
      prisma.company.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: baseCompanySelect
      })
    ]);

    const items = companies.map((company) => ({
      id: company.id_company,
      name: company.name,
      sector: company.sector,
      status: company.validation_status,
      createdAt: company.creation_date,
      updatedAt: company.last_update,
      email: company.email,
      phone: company.phone,
      website: company.website,
      address: company.address,
      siret: company.siret,
      owner: company.owner
        ? {
            id: company.owner.id_user,
            firstName: company.owner.first_name,
            lastName: company.owner.last_name,
            email: company.owner.email
          }
        : null,
      stats: {
        inputs: company._count.inputs,
        outputs: company._count.outputs
      }
    }));

    return res.status(200).json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items
    });
  } catch (error) {
    console.error('? listCompanies:', error);
    return res.status(500).json({ error: 'Impossible de charger les entreprises.' });
  }
};

exports.getCompanyDetail = async (req, res) => {
  try {
    const companyId = parseIntegerParam(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ error: 'Identifiant entreprise invalide' });
    }

    const company = await prisma.company.findUnique({
      where: { id_company: companyId },
      include: {
        owner: {
          select: {
            id_user: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true
          }
        },
        companyTypes: {
          include: { type: true }
        },
        inputs: {
          select: {
            id_input: true,
            name: true,
            category: true,
            status: true,
            last_update: true
          }
        },
        outputs: {
          select: {
            id_output: true,
            name: true,
            category: true,
            status: true,
            is_been: true,
            last_update: true
          }
        },
        suggestionInteractions: {
          select: {
            id_suggestion: true,
            status: true,
            created_at: true,
            updated_at: true
          },
          take: 10,
          orderBy: { updated_at: 'desc' }
        }
      }
    });

    if (!company) {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }

    return res.status(200).json({
      id: company.id_company,
      name: company.name,
      sector: company.sector,
      status: company.validation_status,
      createdAt: company.creation_date,
      updatedAt: company.last_update,
      contact: {
        email: company.email,
        phone: company.phone,
        website: company.website,
        address: company.address
      },
      profile: {
        description: company.description,
        latitude: company.latitude,
        longitude: company.longitude,
        siret: company.siret
      },
      owner: company.owner
        ? {
            id: company.owner.id_user,
            firstName: company.owner.first_name,
            lastName: company.owner.last_name,
            email: company.owner.email,
            phone: company.owner.phone
          }
        : null,
      types: company.companyTypes.map((item) => item.type?.name).filter(Boolean),
      inputs: company.inputs,
      outputs: company.outputs,
      interactions: company.suggestionInteractions
    });
  } catch (error) {
    console.error('? getCompanyDetail:', error);
    return res.status(500).json({ error: "Impossible de récupérer le détail de l'entreprise." });
  }
};

exports.createCompany = async (req, res) => {
  try {
    const payload = companyCreateSchema.parse({
      ...req.body,
      ownerId: req.body.ownerId !== undefined ? Number(req.body.ownerId) : undefined,
      latitude: req.body.latitude !== undefined ? parseNumberParam(req.body.latitude) : undefined,
      longitude: req.body.longitude !== undefined ? parseNumberParam(req.body.longitude) : undefined
    });

    if (payload.ownerId) {
      const ownerExists = await prisma.user.findUnique({
        where: { id_user: payload.ownerId },
        select: { id_user: true }
      });

      if (!ownerExists) {
        return res.status(400).json({ error: 'Propriétaire introuvable', field: 'ownerId' });
      }
    }

    const company = await prisma.company.create({
      data: {
        name: payload.name,
        sector: payload.sector,
        address: payload.address || null,
        description: payload.description || null,
        phone: payload.phone || null,
        email: payload.email || null,
        website: payload.website || null,
        siret: payload.siret,
        validation_status: payload.validationStatus || 'pending',
        owner_id: payload.ownerId || null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        creation_date: new Date(),
        last_update: new Date()
      },
      select: baseCompanySelect
    });

    return res.status(201).json({
      success: true,
      company: {
        id: company.id_company,
        name: company.name,
        status: company.validation_status
      }
    });
  } catch (error) {
    console.error('? createCompany:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Payload invalide', details: error.flatten() });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Une entreprise avec ce SIRET existe déjà.' });
    }
    return res.status(500).json({ error: "Impossible de créer l'entreprise." });
  }
};

exports.updateCompany = async (req, res) => {
  try {
    const companyId = parseIntegerParam(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ error: 'Identifiant entreprise invalide' });
    }

    const payload = companyUpdateSchema.parse({
      ...req.body,
      ownerId: req.body.ownerId !== undefined ? Number(req.body.ownerId) : undefined,
      latitude: req.body.latitude !== undefined ? parseNumberParam(req.body.latitude) : undefined,
      longitude: req.body.longitude !== undefined ? parseNumberParam(req.body.longitude) : undefined
    });

    if (payload.ownerId) {
      const ownerExists = await prisma.user.findUnique({
        where: { id_user: payload.ownerId },
        select: { id_user: true }
      });

      if (!ownerExists) {
        return res.status(400).json({ error: 'Propriétaire introuvable', field: 'ownerId' });
      }
    }

    const company = await prisma.company.update({
      where: { id_company: companyId },
      data: {
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.sector ? { sector: payload.sector } : {}),
        ...(payload.address !== undefined ? { address: payload.address || null } : {}),
        ...(payload.description !== undefined ? { description: payload.description || null } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone || null } : {}),
        ...(payload.email !== undefined ? { email: payload.email || null } : {}),
        ...(payload.website !== undefined ? { website: payload.website || null } : {}),
        ...(payload.siret ? { siret: payload.siret } : {}),
        ...(payload.validationStatus ? { validation_status: payload.validationStatus } : {}),
        ...(payload.ownerId !== undefined ? { owner_id: payload.ownerId || null } : {}),
        ...(payload.latitude !== undefined ? { latitude: payload.latitude ?? null } : {}),
        ...(payload.longitude !== undefined ? { longitude: payload.longitude ?? null } : {}),
        last_update: new Date()
      },
      select: baseCompanySelect
    });

    return res.status(200).json({
      success: true,
      company: {
        id: company.id_company,
        name: company.name,
        status: company.validation_status
      }
    });
  } catch (error) {
    console.error('? updateCompany:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Payload invalide', details: error.flatten() });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Un SIRET identique existe déjà.' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }
    return res.status(500).json({ error: "Impossible de mettre à jour l'entreprise." });
  }
};

exports.updateCompanyStatus = async (req, res) => {
  try {
    const companyId = parseIntegerParam(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ error: 'Identifiant entreprise invalide' });
    }

    const payload = statusUpdateSchema.parse(req.body || {});

    const company = await prisma.company.update({
      where: { id_company: companyId },
      data: {
        validation_status: payload.status,
        last_update: new Date()
      },
      select: {
        id_company: true,
        validation_status: true
      }
    });

    return res.status(200).json({
      success: true,
      company: {
        id: company.id_company,
        status: company.validation_status
      }
    });
  } catch (error) {
    console.error('? updateCompanyStatus:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Payload invalide', details: error.flatten() });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }
    return res.status(500).json({ error: 'Impossible de mettre à jour le statut.' });
  }
};

exports.deleteCompany = async (req, res) => {
  try {
    const companyId = parseIntegerParam(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ error: 'Identifiant entreprise invalide' });
    }

    await prisma.$transaction(async (tx) => {
      const [inputs, outputs] = await Promise.all([
        tx.input.findMany({
          where: { company_id: companyId },
          select: { id_input: true }
        }),
        tx.output.findMany({
          where: { company_id: companyId },
          select: { id_output: true }
        })
      ]);

      const inputIds = inputs.map((item) => item.id_input);
      const outputIds = outputs.map((item) => item.id_output);

      const flowConditions = [];
      if (inputIds.length) {
        flowConditions.push({ input_id: { in: inputIds } });
      }
      if (outputIds.length) {
        flowConditions.push({ output_id: { in: outputIds } });
      }
      if (flowConditions.length) {
        await tx.flow.deleteMany({ where: { OR: flowConditions } });
      }

      await Promise.all([
        tx.companyMessage.deleteMany({ where: { company_id: companyId } }),
        tx.companyConversation.deleteMany({ where: { company_id: companyId } }),
        tx.companyContact.deleteMany({ where: { company_id: companyId } }),
        tx.suggestionInteraction.deleteMany({ where: { target_company_id: companyId } }),
        tx.companyType.deleteMany({ where: { company_id: companyId } }),
        tx.output.deleteMany({ where: { company_id: companyId } }),
        tx.input.deleteMany({ where: { company_id: companyId } })
      ]);

      await tx.company.delete({
        where: { id_company: companyId }
      });
    });

    return res.status(204).send();
  } catch (error) {
    console.error('? deleteCompany:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }
    return res.status(500).json({ error: "Impossible de supprimer l'entreprise." });
  }
};

exports.exportCompanies = async (req, res) => {
  try {
    const where = normaliseCompanyFilters(req.query);
    const companies = await prisma.company.findMany({
      where,
      orderBy: { creation_date: 'desc' },
      take: 2000,
      select: baseCompanySelect
    });

    const escapeCell = (value) => {
      if (value === null || value === undefined) {
        return '';
      }
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = [
      'ID',
      'Nom',
      'Secteur',
      'Statut',
      'SIRET',
      'Email',
      'Téléphone',
      'Adresse',
      'Site web',
      'Création',
      'Dernière mise à jour',
      'Propriétaire',
      'Inputs',
      'Outputs'
    ];

    const rows = companies.map((company) => [
      company.id_company,
      company.name,
      company.sector,
      company.validation_status,
      company.siret,
      company.email || '',
      company.phone || '',
      company.address || '',
      company.website || '',
      company.creation_date.toISOString(),
      company.last_update.toISOString(),
      company.owner ? `${company.owner.first_name || ''} ${company.owner.last_name || ''}`.trim() : '',
      company._count.inputs,
      company._count.outputs
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(escapeCell).join(';'))
      .join('\n');

    const filename = `export-companies-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.status(200).send(csv);
  } catch (error) {
    console.error('? exportCompanies:', error);
    return res.status(500).json({ error: "Impossible de générer l'export." });
  }
};

exports.getPendingModeration = async (req, res) => {
  try {
    const where = {
      validation_status: { notIn: Array.from(ACTIVE_STATUSES) }
    };

    const items = await prisma.company.findMany({
      where,
      orderBy: { creation_date: 'desc' },
      take: 200,
      select: {
        id_company: true,
        name: true,
        sector: true,
        validation_status: true,
        creation_date: true,
        last_update: true,
        email: true,
        owner: {
          select: {
            id_user: true,
            first_name: true,
            last_name: true,
            email: true
          }
        }
      }
    });

    return res.status(200).json({
      total: items.length,
      items: items.map((item) => ({
        id: item.id_company,
        name: item.name,
        sector: item.sector,
        status: item.validation_status,
        createdAt: item.creation_date,
        updatedAt: item.last_update,
        email: item.email,
        owner: item.owner
          ? {
              id: item.owner.id_user,
              firstName: item.owner.first_name,
              lastName: item.owner.last_name,
              email: item.owner.email
            }
          : null,
        isCritical: CRITICAL_STATUSES.has((item.validation_status || '').toLowerCase())
      }))
    });
  } catch (error) {
    console.error('? getPendingModeration:', error);
    return res.status(500).json({ error: 'Impossible de récupérer la file de modération.' });
  }
};

exports.getSystemStats = async (req, res) => {
  try {
    const now = new Date();
    const months = buildMonthlyBuckets(12, now);
    const firstBucketStart = months.length ? months[0].start : startOfMonth(now);

    const [companies, conversations, sectorDistributionRaw] = await Promise.all([
      prisma.company.findMany({
        where: { creation_date: { gte: firstBucketStart } },
        select: { creation_date: true }
      }),
      prisma.companyConversation.findMany({
        where: { created_at: { gte: firstBucketStart } },
        select: { created_at: true }
      }),
      prisma.company.groupBy({
        by: ['sector'],
        _count: { _all: true }
      })
    ]);

    const monthKey = (date) => {
      const d = buildDate(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const monthIndex = new Map(months.map((bucket, index) => [bucket.label, index]));

    companies.forEach((item) => {
      const key = monthKey(item.creation_date);
      if (monthIndex.has(key)) {
        months[monthIndex.get(key)].total += 1;
      }
    });

    const conversationBuckets = buildMonthlyBuckets(12, now);
    const conversationIndex = new Map(conversationBuckets.map((bucket, index) => [bucket.label, index]));

    conversations.forEach((item) => {
      const key = monthKey(item.created_at);
      if (conversationIndex.has(key)) {
        conversationBuckets[conversationIndex.get(key)].total += 1;
      }
    });

    const sectorDistribution = sectorDistributionRaw
      .sort((a, b) => b._count._all - a._count._all)
      .map((item) => ({
        sector: item.sector || 'Non renseigné',
        total: item._count._all
      }));

    return res.status(200).json({
      monthlySignups: months,
      sectorDistribution,
      connectionTrends: conversationBuckets
    });
  } catch (error) {
    console.error('? getSystemStats:', error);
    return res.status(500).json({ error: 'Impossible de charger les statistiques système.' });
  }
};
