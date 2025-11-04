const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();
const { z } = require('zod');
const {
  normalizeArrayParam,
  parseNumberParam,
  parseIntegerParam
} = require('../lib/params');
const { haversineDistance } = require('../lib/geo');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const DIRECTORY_CACHE_TTL_MS = 60 * 1000; // 1 minute
const DIRECTORY_CACHE_MAX_ENTRIES = 200;
const DIRECTORY_ALLOWED_STATUSES = ['validated', 'approved', 'pending', 'active'];
const DEFAULT_REFERENCE_COORDINATES = {
  latitude: 43.2965,
  longitude: 5.5653
};

const searchCache = new Map();

const companyIdParamSchema = z.object({
  companyId: z.coerce.number().int().positive()
});

const deepClone = (value) => JSON.parse(JSON.stringify(value));

 

const trimDescription = (value, maxLength = 220) => {
  if (!value) {
    return null;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trim()}…`;
};

const getCacheKey = (params, page, limit) => JSON.stringify({
  search: params.search || null,
  sectors: [...(params.sectors || [])].sort(),
  wasteTypes: [...(params.wasteTypes || [])].sort(),
  maxDistance: params.maxDistance ?? null,
  sort: params.sort,
  userLat: params.userLat ?? null,
  userLng: params.userLng ?? null,
  page,
  limit
});

const getCachedSearch = (key) => {
  const cached = searchCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.timestamp > DIRECTORY_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }

  return deepClone(cached.payload);
};

const setCachedSearch = (key, payload) => {
  searchCache.set(key, {
    timestamp: Date.now(),
    payload: deepClone(payload)
  });

  if (searchCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }
};

const invalidateDirectoryCache = () => {
  searchCache.clear();
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const sendError = (res, error, fallbackMessage = 'Erreur interne du serveur') => {
  const status = error.status || 500;
  const payload = {
    success: false,
    error: error.message || fallbackMessage
  };

  if (error.details) {
    payload.details = error.details;
  }

  return res.status(status).json(payload);
};

const buildCompanyInclude = () => ({
  companyTypes: {
    include: { type: true }
  },
  inputs: {
    include: { family: true }
  },
  outputs: {
    include: { family: true }
  }
});

const getCompanyByOwnerOrThrow = async (userId, options = {}) => {
  const company = await prisma.company.findFirst({
    where: { owner_id: userId },
    ...options
  });

  if (!company) {
    throw new HttpError(404, 'Entreprise non trouvée');
  }

  return company;
};

const getCompanyIdByOwnerOrThrow = async (userId) => {
  const company = await getCompanyByOwnerOrThrow(userId, { select: { id_company: true } });
  return company.id_company;
};

const searchQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  sectors: z.array(z.string().trim().min(1)).optional(),
  wasteTypes: z.array(z.string().trim().min(1)).optional(),
  maxDistance: z.number().positive().max(500).optional(),
  page: z.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.enum(['distance', 'relevance', 'validation']).optional(),
  userLat: z.number().min(-90).max(90).optional(),
  userLng: z.number().min(-180).max(180).optional()
}).superRefine((data, ctx) => {
  if ((data.userLat === undefined) !== (data.userLng === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La latitude et la longitude doivent être fournies ensemble',
      path: ['userLat']
    });
  }

  if (data.sort === 'distance' && (data.userLat === undefined || data.userLng === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Les coordonnées utilisateur sont requises pour le tri par distance',
      path: ['sort']
    });
  }
});

const directoryCompanySelect = {
  id_company: true,
  name: true,
  sector: true,
  address: true,
  latitude: true,
  longitude: true,
  phone: true,
  email: true,
  website: true,
  description: true,
  validation_status: true,
  creation_date: true,
  last_update: true,
  companyTypes: {
    select: {
      type: {
        select: {
          name: true
        }
      }
    }
  },
  outputs: {
    select: {
      id_output: true,
      name: true,
      category: true,
      is_been: true,
      unit_measure: true,
      description: true,
      status: true,
      family: {
        select: {
          name: true
        }
      }
    }
  },
  inputs: {
    select: {
      id_input: true,
      name: true,
      category: true,
      unit_measure: true,
      description: true,
      status: true,
      family: {
        select: {
          name: true
        }
      }
    }
  }
};

// Schémas de validation Zod
const companyGeneralSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  sector: z.string().min(1).max(50).trim(),
  description: z.string().optional(),
  phone: z.string().min(5).max(30).trim(),
  email: z.string().email().min(5).max(100).trim(),
  website: z.string().url().optional(),
  siret: z.string().min(9).max(20).trim()
});

const productionSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  category: z.string().min(1).max(50).trim(),
  unit_measure: z.string().min(1).max(20).trim(),
  description: z.string().optional(),
  status: z.string().default("active")
});

const besoinSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  category: z.string().min(1).max(50).trim(),
  unit_measure: z.string().min(1).max(20).trim(),
  description: z.string().optional(),
  status: z.string().default("active")
});

const dechetSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  category: z.string().min(1).max(50).trim(),
  unit_measure: z.string().min(1).max(20).trim(),
  description: z.string().optional(),
  is_been: z.boolean().default(false),
  status: z.string().default("active")
});

const geolocationSchema = z.object({
  address: z.string().min(1).max(255).trim(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const createCompanySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  sector: z.string().min(1).max(50).trim(),
  address: z.string().min(1).max(255).trim(),
  description: z.string().optional(),
  phone: z.string().min(5).max(30).trim(),
  email: z.string().email().min(5).max(100).trim(),
  website: z.string().url().optional(),
  siret: z.string().min(9).max(20).trim(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

// ===================
// COMPANY CREATION
// ===================

exports.createCompany = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = createCompanySchema.parse(req.body);

    // Vérifier si l'utilisateur a déjà une entreprise
    const existingCompany = await prisma.company.findFirst({
      where: { owner_id: userId },
      select: {
        id_company: true,
        name: true
      }
    });

    if (existingCompany) {
      return res.status(409).json({
        success: false,
        error: 'Vous possédez déjà une entreprise',
        existingCompany: {
          id: existingCompany.id_company,
          name: existingCompany.name
        }
      });
    }

    const newCompany = await prisma.company.create({
      data: {
        name: validatedData.name,
        sector: validatedData.sector,
        address: validatedData.address,
        description: validatedData.description,
        phone: validatedData.phone,
        email: validatedData.email,
        website: validatedData.website,
        siret: validatedData.siret,
        latitude: validatedData.latitude || 0,
        longitude: validatedData.longitude || 0,
        validation_status: 'pending',
        owner_id: userId,
        creation_date: new Date(),
        last_update: new Date()
      }
    });

    const responsePayload = {
      id: newCompany.id_company,
      name: newCompany.name,
      sector: newCompany.sector,
      address: newCompany.address,
      phone: newCompany.phone,
      email: newCompany.email,
      website: newCompany.website,
      siret: newCompany.siret,
      validation_status: newCompany.validation_status,
      creation_date: newCompany.creation_date
    };

    invalidateDirectoryCache();

    return res.status(201).json({
      success: true,
      message: 'Entreprise créée avec succès',
      data: responsePayload,
      company: responsePayload
    });
  } catch (error) {
    console.error('❌ Erreur createCompany:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    return sendError(res, error);
  }
};

// ===================
// COMPANY PROFILE
// ===================

exports.getCompanyProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const company = await getCompanyByOwnerOrThrow(userId, { include: buildCompanyInclude() });

    const companyPayload = {
      id: company.id_company,
      name: company.name,
      siret: company.siret,
      sector: company.sector,
      address: company.address,
      latitude: company.latitude,
      longitude: company.longitude,
      phone: company.phone,
      email: company.email,
      website: company.website,
      description: company.description,
      validationStatus: company.validation_status,
      creationDate: company.creation_date,
      lastUpdate: company.last_update,
      types: company.companyTypes.map(ct => ct.type.name),
      productions: company.outputs
        .filter(output => !output.is_been)
        .map(output => ({
          id: output.id_output,
          name: output.name,
          category: output.category,
          unit_measure: output.unit_measure,
          description: output.description,
          status: output.status,
          is_been: output.is_been,
          family: output.family?.name
        })),
      besoins: company.inputs.map(input => ({
        id: input.id_input,
        name: input.name,
        category: input.category,
        unit_measure: input.unit_measure,
        description: input.description,
        status: input.status,
        family: input.family?.name
      })),
      dechets: company.outputs
        .filter(output => output.is_been)
        .map(output => ({
          id: output.id_output,
          name: output.name,
          category: output.category,
          unit_measure: output.unit_measure,
          description: output.description,
          status: output.status,
          is_been: output.is_been,
          family: output.family?.name
        }))
    };

    return res.status(200).json({
      success: true,
      data: companyPayload,
      company: companyPayload
    });
  } catch (error) {
    console.error('❌ Erreur getCompanyProfile:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.updateCompanyGeneral = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = companyGeneralSchema.parse(req.body);

    const company = await getCompanyByOwnerOrThrow(userId);

    const updatedCompany = await prisma.company.update({
      where: { id_company: company.id_company },
      data: {
        name: validatedData.name,
        sector: validatedData.sector,
        description: validatedData.description ?? company.description,
        phone: validatedData.phone,
        email: validatedData.email,
        website: validatedData.website ?? company.website,
        siret: validatedData.siret,
        last_update: new Date()
      },
      include: {
        companyTypes: {
          include: { type: true }
        }
      }
    });

    const payload = {
      id: updatedCompany.id_company,
      name: updatedCompany.name,
      sector: updatedCompany.sector,
      description: updatedCompany.description,
      phone: updatedCompany.phone,
      email: updatedCompany.email,
      website: updatedCompany.website,
      siret: updatedCompany.siret,
      types: updatedCompany.companyTypes.map(ct => ct.type.name)
    };

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Informations générales mises à jour avec succès',
      data: payload,
      company: payload
    });
  } catch (error) {
    console.error('❌ Erreur updateCompanyGeneral:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

// ===================
// PRODUCTIONS (OUTPUTS)
// ===================

exports.getProductions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const productions = await prisma.output.findMany({
      where: { company_id: companyId, is_been: false },
      include: { family: true },
      orderBy: { creation_date: 'desc' }
    });

    const productionsWithDetails = productions.map(production => ({
      id: production.id_output,
      name: production.name,
      category: production.category,
      unit_measure: production.unit_measure,
      description: production.description,
      status: production.status,
      is_been: production.is_been,
      family: production.family?.name,
      creationDate: production.creation_date,
      lastUpdate: production.last_update
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: productionsWithDetails,
        total: productionsWithDetails.length
      },
      productions: productionsWithDetails,
      total: productionsWithDetails.length
    });
  } catch (error) {
    console.error('❌ Erreur getProductions:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.addProduction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = productionSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const newProduction = await prisma.output.create({
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        is_been: false, // Les productions ne sont pas des déchets
        company_id: companyId
      },
      include: { family: true }
    });

    const payload = {
      id: newProduction.id_output,
      name: newProduction.name,
      category: newProduction.category,
      unit_measure: newProduction.unit_measure,
      description: newProduction.description,
      status: newProduction.status,
      is_been: newProduction.is_been,
      family: newProduction.family?.name,
      creationDate: newProduction.creation_date
    };

    invalidateDirectoryCache();

    return res.status(201).json({
      success: true,
      message: 'Production ajoutée avec succès',
      data: payload,
      production: payload
    });
  } catch (error) {
    console.error('❌ Erreur addProduction:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.updateProduction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const productionId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(productionId)) {
      throw new HttpError(400, 'Identifiant de production invalide');
    }
    const validatedData = productionSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const production = await prisma.output.findFirst({
      where: {
        id_output: productionId,
        company_id: companyId,
        is_been: false
      }
    });

    if (!production) {
      throw new HttpError(404, 'Production non trouvée');
    }

    const updatedProduction = await prisma.output.update({
      where: { id_output: productionId },
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        last_update: new Date()
      },
      include: { family: true }
    });

    const payload = {
      id: updatedProduction.id_output,
      name: updatedProduction.name,
      category: updatedProduction.category,
      unit_measure: updatedProduction.unit_measure,
      description: updatedProduction.description,
      status: updatedProduction.status,
      is_been: updatedProduction.is_been,
      family: updatedProduction.family?.name,
      lastUpdate: updatedProduction.last_update
    };

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Production mise à jour avec succès',
      data: payload,
      production: payload
    });
  } catch (error) {
    console.error('❌ Erreur updateProduction:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.deleteProduction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const productionId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(productionId)) {
      throw new HttpError(400, 'Identifiant de production invalide');
    }
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const production = await prisma.output.findFirst({
      where: {
        id_output: productionId,
        company_id: companyId,
        is_been: false
      }
    });

    if (!production) {
      throw new HttpError(404, 'Production non trouvée');
    }

    await prisma.output.delete({
      where: { id_output: productionId }
    });

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Production supprimée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur deleteProduction:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

// ===================
// BESOINS (INPUTS)
// ===================

exports.getBesoins = async (req, res) => {
  try {
    const userId = req.user.userId;
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const besoins = await prisma.input.findMany({
      where: { company_id: companyId },
      include: { family: true },
      orderBy: { creation_date: 'desc' }
    });

    const besoinsWithDetails = besoins.map(besoin => ({
      id: besoin.id_input,
      name: besoin.name,
      category: besoin.category,
      unit_measure: besoin.unit_measure,
      description: besoin.description,
      status: besoin.status,
      family: besoin.family?.name,
      creationDate: besoin.creation_date,
      lastUpdate: besoin.last_update
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: besoinsWithDetails,
        total: besoinsWithDetails.length
      },
      besoins: besoinsWithDetails,
      total: besoinsWithDetails.length
    });
  } catch (error) {
    console.error('❌ Erreur getBesoins:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.addBesoin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = besoinSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const newBesoin = await prisma.input.create({
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        company_id: companyId
      },
      include: { family: true }
    });

    const payload = {
      id: newBesoin.id_input,
      name: newBesoin.name,
      category: newBesoin.category,
      unit_measure: newBesoin.unit_measure,
      description: newBesoin.description,
      status: newBesoin.status,
      family: newBesoin.family?.name,
      creationDate: newBesoin.creation_date
    };

    invalidateDirectoryCache();

    return res.status(201).json({
      success: true,
      message: 'Besoin ajouté avec succès',
      data: payload,
      besoin: payload
    });
  } catch (error) {
    console.error('❌ Erreur addBesoin:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.updateBesoin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const besoinId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(besoinId)) {
      throw new HttpError(400, 'Identifiant de besoin invalide');
    }
    const validatedData = besoinSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const besoin = await prisma.input.findFirst({
      where: {
        id_input: besoinId,
        company_id: companyId
      }
    });

    if (!besoin) {
      throw new HttpError(404, 'Besoin non trouvé');
    }

    const updatedBesoin = await prisma.input.update({
      where: { id_input: besoinId },
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        last_update: new Date()
      },
      include: { family: true }
    });

    const payload = {
      id: updatedBesoin.id_input,
      name: updatedBesoin.name,
      category: updatedBesoin.category,
      unit_measure: updatedBesoin.unit_measure,
      description: updatedBesoin.description,
      status: updatedBesoin.status,
      family: updatedBesoin.family?.name,
      lastUpdate: updatedBesoin.last_update
    };

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Besoin mis à jour avec succès',
      data: payload,
      besoin: payload
    });
  } catch (error) {
    console.error('❌ Erreur updateBesoin:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.deleteBesoin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const besoinId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(besoinId)) {
      throw new HttpError(400, 'Identifiant de besoin invalide');
    }
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const besoin = await prisma.input.findFirst({
      where: {
        id_input: besoinId,
        company_id: companyId
      }
    });

    if (!besoin) {
      throw new HttpError(404, 'Besoin non trouvé');
    }

    await prisma.input.delete({
      where: { id_input: besoinId }
    });

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Besoin supprimé avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur deleteBesoin:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

// ===================
// DECHETS (OUTPUTS avec is_been = true)
// ===================

exports.getDechets = async (req, res) => {
  try {
    const userId = req.user.userId;
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const dechets = await prisma.output.findMany({
      where: {
        company_id: companyId,
        is_been: true
      },
      include: { family: true },
      orderBy: { creation_date: 'desc' }
    });

    const dechetsWithDetails = dechets.map(dechet => ({
      id: dechet.id_output,
      name: dechet.name,
      category: dechet.category,
      unit_measure: dechet.unit_measure,
      description: dechet.description,
      status: dechet.status,
      is_been: dechet.is_been,
      family: dechet.family?.name,
      creationDate: dechet.creation_date,
      lastUpdate: dechet.last_update
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: dechetsWithDetails,
        total: dechetsWithDetails.length
      },
      dechets: dechetsWithDetails,
      total: dechetsWithDetails.length
    });
  } catch (error) {
    console.error('❌ Erreur getDechets:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.addDechet = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = dechetSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const newDechet = await prisma.output.create({
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        is_been: true, // Les déchets ont is_been = true
        company_id: companyId
      },
      include: { family: true }
    });

    const payload = {
      id: newDechet.id_output,
      name: newDechet.name,
      category: newDechet.category,
      unit_measure: newDechet.unit_measure,
      description: newDechet.description,
      status: newDechet.status,
      is_been: newDechet.is_been,
      family: newDechet.family?.name,
      creationDate: newDechet.creation_date
    };

    invalidateDirectoryCache();

    return res.status(201).json({
      success: true,
      message: 'Déchet ajouté avec succès',
      data: payload,
      dechet: payload
    });
  } catch (error) {
    console.error('❌ Erreur addDechet:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.updateDechet = async (req, res) => {
  try {
    const userId = req.user.userId;
    const dechetId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(dechetId)) {
      throw new HttpError(400, 'Identifiant de déchet invalide');
    }
    const validatedData = dechetSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const dechet = await prisma.output.findFirst({
      where: {
        id_output: dechetId,
        company_id: companyId,
        is_been: true
      }
    });

    if (!dechet) {
      throw new HttpError(404, 'Déchet non trouvé');
    }

    const updatedDechet = await prisma.output.update({
      where: { id_output: dechetId },
      data: {
        name: validatedData.name,
        category: validatedData.category,
        unit_measure: validatedData.unit_measure,
        description: validatedData.description,
        status: validatedData.status,
        last_update: new Date()
      },
      include: { family: true }
    });

    const payload = {
      id: updatedDechet.id_output,
      name: updatedDechet.name,
      category: updatedDechet.category,
      unit_measure: updatedDechet.unit_measure,
      description: updatedDechet.description,
      status: updatedDechet.status,
      is_been: updatedDechet.is_been,
      family: updatedDechet.family?.name,
      lastUpdate: updatedDechet.last_update
    };

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Déchet mis à jour avec succès',
      data: payload,
      dechet: payload
    });
  } catch (error) {
    console.error('❌ Erreur updateDechet:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.deleteDechet = async (req, res) => {
  try {
    const userId = req.user.userId;
    const dechetId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(dechetId)) {
      throw new HttpError(400, 'Identifiant de déchet invalide');
    }
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const dechet = await prisma.output.findFirst({
      where: {
        id_output: dechetId,
        company_id: companyId,
        is_been: true
      }
    });

    if (!dechet) {
      throw new HttpError(404, 'Déchet non trouvé');
    }

    await prisma.output.delete({
      where: { id_output: dechetId }
    });

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Déchet supprimé avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur deleteDechet:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

// ===================
// DIRECTORY SEARCH & DETAIL
// ===================

const computeRelevanceScore = (company, searchTerm) => {
  if (!searchTerm) {
    return 0;
  }

  const term = searchTerm.toLowerCase();
  let score = 0;

  const bump = (value, weight) => {
    if (!value) {
      return;
    }
    if (value.toLowerCase().includes(term)) {
      score += weight;
    }
  };

  bump(company.name, 12);
  bump(company.sector, 6);
  bump(company.description, 3);

  company.companyTypes?.forEach(ct => bump(ct.type?.name, 4));
  company.outputs?.forEach(output => {
    bump(output.name, output.is_been ? 4 : 3);
    bump(output.category, 2.5);
    bump(output.family?.name, 2.5);
  });
  company.inputs?.forEach(input => {
    bump(input.name, 2.5);
    bump(input.category, 2);
    bump(input.family?.name, 2);
  });

  return score;
};

const sortDirectoryCompanies = (companies, sortMode) => {
  const sorted = [...companies];

  switch (sortMode) {
    case 'distance':
      sorted.sort((a, b) => (a.distanceSortValue ?? Number.POSITIVE_INFINITY) - (b.distanceSortValue ?? Number.POSITIVE_INFINITY));
      break;
    case 'relevance':
      sorted.sort((a, b) => {
        const diff = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
        if (diff !== 0) {
          return diff;
        }
        return (a.distanceSortValue ?? Number.POSITIVE_INFINITY) - (b.distanceSortValue ?? Number.POSITIVE_INFINITY);
      });
      break;
    case 'validation':
    default:
      sorted.sort((a, b) => new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime());
      break;
  }

  return sorted;
};

const collectFacets = (companies) => {
  const sectorCounts = new Map();
  const wasteCounts = new Map();

  companies.forEach(company => {
    if (company.sector) {
      sectorCounts.set(company.sector, (sectorCounts.get(company.sector) || 0) + 1);
    }

    (company.wasteTypes || []).forEach(type => {
      wasteCounts.set(type, (wasteCounts.get(type) || 0) + 1);
    });
  });

  const mapToArray = (map) => Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    sectors: mapToArray(sectorCounts),
    wasteTypes: mapToArray(wasteCounts)
  };
};

const buildAppliedFilters = (params) => ({
  search: params.search ?? null,
  sectors: params.sectors,
  wasteTypes: params.wasteTypes,
  maxDistance: params.maxDistance ?? null,
  sort: params.sort,
  userCoordinates: (params.userLat !== undefined && params.userLng !== undefined)
    ? { latitude: params.userLat, longitude: params.userLng }
    : null
});

const transformCompanyForDirectory = (company, params) => {
  const { userLat, userLng } = params;

  const hasCoordinates = typeof company.latitude === 'number' && typeof company.longitude === 'number' && !(company.latitude === 0 && company.longitude === 0);

  const hasUserCoordinates = userLat !== undefined && userLng !== undefined;

  const actualDistance = (hasUserCoordinates && hasCoordinates)
    ? haversineDistance(userLat, userLng, company.latitude, company.longitude)
    : null;

  const referenceDistance = (!hasUserCoordinates && hasCoordinates)
    ? haversineDistance(
        DEFAULT_REFERENCE_COORDINATES.latitude,
        DEFAULT_REFERENCE_COORDINATES.longitude,
        company.latitude,
        company.longitude
      )
    : null;

  const distanceForDisplay = actualDistance ?? referenceDistance;

  const outputs = company.outputs || [];
  const inputs = company.inputs || [];

  const productions = [];
  const dechets = [];
  const wasteTypesSet = new Set();

  outputs.forEach(output => {
    const base = {
      id: output.id_output,
      name: output.name,
      category: output.category,
      family: output.family?.name || null,
      unitMeasure: output.unit_measure,
      description: output.description,
      status: output.status
    };

    if (output.is_been) {
      dechets.push(base);
      if (base.family) {
        wasteTypesSet.add(base.family);
      } else if (base.category) {
        wasteTypesSet.add(base.category);
      }
    } else {
      productions.push(base);
    }
  });

  const besoins = inputs.map(input => ({
    id: input.id_input,
    name: input.name,
    category: input.category,
    family: input.family?.name || null,
    unitMeasure: input.unit_measure,
    description: input.description,
    status: input.status
  }));

  const tagsSet = new Set();
  company.companyTypes?.forEach(ct => {
    if (ct.type?.name) {
      tagsSet.add(ct.type.name);
    }
  });
  wasteTypesSet.forEach(type => tagsSet.add(type));

  const distanceKm = distanceForDisplay !== null ? Number(distanceForDisplay.toFixed(2)) : null;

  return {
    id: company.id_company,
    name: company.name,
    sector: company.sector,
    address: company.address,
    coordinates: hasCoordinates
      ? {
          latitude: company.latitude,
          longitude: company.longitude
        }
      : null,
    description: trimDescription(company.description),
    contact: {
      phone: company.phone,
      email: company.email,
      website: company.website
    },
    summary: {
      productions: productions.slice(0, 3),
      besoins: besoins.slice(0, 3),
      dechets: dechets.slice(0, 3)
    },
    wasteTypes: Array.from(wasteTypesSet),
    tags: Array.from(tagsSet).slice(0, 8),
    distanceKm,
    distance: distanceKm,
    distanceSource: actualDistance !== null ? 'user' : (referenceDistance !== null ? 'reference' : null),
    validationStatus: company.validation_status,
    creationDate: company.creation_date,
    lastUpdate: company.last_update,
    relevanceScore: computeRelevanceScore(company, params.search),
    distanceSortValue: actualDistance ?? Number.POSITIVE_INFINITY
  };
};

const buildCompanyWhereClause = (params) => {
  const where = {};

  if (DIRECTORY_ALLOWED_STATUSES.length > 0) {
    where.validation_status = {
      in: DIRECTORY_ALLOWED_STATUSES
    };
  }

  if (params.sectors.length > 0) {
    where.sector = {
      in: params.sectors
    };
  }

  if (params.wasteTypes.length > 0) {
    where.outputs = {
      some: {
        is_been: true,
        OR: [
          { category: { in: params.wasteTypes } },
          { family: { name: { in: params.wasteTypes } } }
        ]
      }
    };
  }

  if (params.search) {
    const like = {
      contains: params.search
    };

    where.OR = [
      { name: like },
      { sector: like },
      { description: like },
      { companyTypes: { some: { type: { name: like } } } },
      { outputs: { some: { name: like } } },
      { outputs: { some: { category: like } } },
      { outputs: { some: { family: { name: like } } } },
      { inputs: { some: { name: like } } },
      { inputs: { some: { category: like } } },
      { inputs: { some: { family: { name: like } } } }
    ];
  }

  if (params.maxDistance && params.userLat !== undefined && params.userLng !== undefined) {
    const latDelta = params.maxDistance / 111;
    const lngDelta = params.maxDistance / (111 * Math.cos(params.userLat * Math.PI / 180) || 1);

    where.latitude = {
      gte: params.userLat - latDelta,
      lte: params.userLat + latDelta
    };
    where.longitude = {
      gte: params.userLng - lngDelta,
      lte: params.userLng + lngDelta
    };
  }

  return where;
};

const buildDirectoryDataset = async (params) => {
  const where = buildCompanyWhereClause(params);

  const companies = await prisma.company.findMany({
    where,
    select: directoryCompanySelect
  });

  const transformed = companies.map(company => transformCompanyForDirectory(company, params));

  const filtered = params.maxDistance
    ? transformed.filter(company => company.distanceKm !== null && company.distanceKm <= params.maxDistance)
    : transformed;

  const facets = collectFacets(filtered);

  return {
    items: filtered,
    facets
  };
};

const parseSearchParams = (req) => {
  const { query, headers } = req;

  const rawSectors = normalizeArrayParam(query.sectors);
  const rawWasteTypes = normalizeArrayParam(query.wasteTypes);

  const rawSort = typeof query.sort === 'string' ? query.sort.toLowerCase() : undefined;
  let normalizedSort = rawSort === 'distance' || rawSort === 'relevance' || rawSort === 'validation' || rawSort === 'recent'
    ? (rawSort === 'recent' ? 'validation' : rawSort)
    : undefined;

  let userLatRaw = parseNumberParam(query.lat ?? query.latitude ?? headers['x-user-lat'] ?? headers['x-user-latitude']);
  let userLngRaw = parseNumberParam(query.lng ?? query.longitude ?? headers['x-user-lng'] ?? headers['x-user-longitude']);

  if ((userLatRaw === undefined) !== (userLngRaw === undefined)) {
    userLatRaw = undefined;
    userLngRaw = undefined;
  }

  let maxDistanceRaw = parseNumberParam(query.maxDistance);

  if (normalizedSort === 'distance' && (userLatRaw === undefined || userLngRaw === undefined)) {
    normalizedSort = undefined;
  }

  const parsed = searchQuerySchema.parse({
    search: typeof query.search === 'string' && query.search.trim().length ? query.search.trim() : undefined,
    sectors: rawSectors.length ? rawSectors : undefined,
    wasteTypes: rawWasteTypes.length ? rawWasteTypes : undefined,
    maxDistance: maxDistanceRaw,
    page: parseIntegerParam(query.page),
    limit: parseIntegerParam(query.limit),
    sort: normalizedSort,
    userLat: userLatRaw,
    userLng: userLngRaw
  });

  return {
    ...parsed,
    sectors: parsed.sectors ?? [],
    wasteTypes: parsed.wasteTypes ?? [],
    sort: parsed.sort ?? (parsed.search ? 'relevance' : 'validation')
  };
};

exports.searchCompanies = async (req, res) => {
  const startedAt = Date.now();

  try {
    const params = parseSearchParams(req);
    const cacheKey = getCacheKey(params, params.page, params.limit);
    const cached = getCachedSearch(cacheKey);

    if (cached) {
      cached.meta = {
        ...(cached.meta || {}),
        cached: true,
        executionMs: Date.now() - startedAt
      };
      return res.status(200).json(cached);
    }

    const dataset = await buildDirectoryDataset(params);
    const sorted = sortDirectoryCompanies(dataset.items, params.sort);

    const total = sorted.length;
    const offset = (params.page - 1) * params.limit;
    const paginated = sorted
      .slice(offset, offset + params.limit)
      .map(({ relevanceScore, distanceSortValue, ...rest }) => rest);

    const responsePayload = {
      success: true,
      data: {
        items: paginated,
        companies: paginated,
        total,
        page: params.page,
        limit: params.limit,
        hasMore: offset + params.limit < total,
        facets: dataset.facets,
        appliedFilters: buildAppliedFilters(params)
      },
      companies: paginated,
      meta: {
        executionMs: Date.now() - startedAt,
        cached: false
      }
    };

    setCachedSearch(cacheKey, responsePayload);

    console.info('🔎 searchCompanies', {
      filters: responsePayload.data.appliedFilters,
      total,
      page: params.page,
      limit: params.limit,
      durationMs: responsePayload.meta.executionMs
    });

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('❌ Erreur searchCompanies:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Paramètres de recherche invalides', error.errors));
    }
    return sendError(res, error);
  }
};

exports.getCompanyFilters = async (req, res) => {
  const startedAt = Date.now();

  try {
    const params = parseSearchParams(req);
    const dataset = await buildDirectoryDataset(params);

    const responsePayload = {
      success: true,
      data: {
        total: dataset.items.length,
        facets: dataset.facets,
        appliedFilters: buildAppliedFilters(params)
      },
      meta: {
        executionMs: Date.now() - startedAt
      }
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('❌ Erreur getCompanyFilters:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Paramètres de recherche invalides', error.errors));
    }
    return sendError(res, error);
  }
};

exports.getCompanyDetail = async (req, res) => {
  try {
    const parsedParams = companyIdParamSchema.safeParse({
      companyId: req.params.companyId ?? req.params.id
    });

    if (!parsedParams.success) {
      throw new HttpError(400, 'Identifiant d\'entreprise invalide', parsedParams.error.issues);
    }

    const companyId = parsedParams.data.companyId;

    const company = await prisma.company.findUnique({
      where: { id_company: companyId },
      include: {
        companyTypes: {
          include: { type: true }
        },
        outputs: {
          include: { family: true }
        },
        inputs: {
          include: { family: true }
        }
      }
    });

    if (!company) {
      throw new HttpError(404, 'Entreprise non trouvée');
    }

    const outputs = company.outputs || [];
    const inputs = company.inputs || [];

    const productions = outputs
      .filter(output => !output.is_been)
      .map(output => ({
        id: output.id_output,
        name: output.name,
        category: output.category,
        family: output.family?.name || null,
        unitMeasure: output.unit_measure,
        description: output.description,
        status: output.status,
        lastUpdate: output.last_update
      }));

    const dechets = outputs
      .filter(output => output.is_been)
      .map(output => ({
        id: output.id_output,
        name: output.name,
        category: output.category,
        family: output.family?.name || null,
        unitMeasure: output.unit_measure,
        description: output.description,
        status: output.status,
        lastUpdate: output.last_update
      }));

    const besoins = inputs.map(input => ({
      id: input.id_input,
      name: input.name,
      category: input.category,
      family: input.family?.name || null,
      unitMeasure: input.unit_measure,
      description: input.description,
      status: input.status,
      lastUpdate: input.last_update
    }));

    const wasteTypes = Array.from(new Set(dechets
      .map(dechet => dechet.family || dechet.category)
      .filter(Boolean)));

    const tags = Array.from(new Set([
      ...company.companyTypes.map(ct => ct.type?.name).filter(Boolean),
      ...wasteTypes
    ]));

    const payload = {
      id: company.id_company,
      name: company.name,
      sector: company.sector,
      description: company.description,
      address: company.address,
      coordinates: {
        latitude: company.latitude,
        longitude: company.longitude
      },
      contact: {
        phone: company.phone,
        email: company.email,
        website: company.website
      },
      tags,
      wasteTypes,
      productions,
      besoins,
      dechets,
      validationStatus: company.validation_status,
      creationDate: company.creation_date,
      lastUpdate: company.last_update
    };

    return res.status(200).json({
      success: true,
      data: payload,
      company: payload
    });
  } catch (error) {
    console.error('❌ Erreur getCompanyDetail:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

// ===================
// GEOLOCATION
// ===================

exports.getGeolocation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const company = await getCompanyByOwnerOrThrow(userId, {
      select: {
        address: true,
        latitude: true,
        longitude: true
      }
    });

    const payload = {
      address: company.address,
      latitude: company.latitude,
      longitude: company.longitude
    };

    return res.status(200).json({
      success: true,
      data: payload,
      geolocation: payload
    });
  } catch (error) {
    console.error('❌ Erreur getGeolocation:', error);
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};

exports.updateGeolocation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const validatedData = geolocationSchema.parse(req.body);
    const companyId = await getCompanyIdByOwnerOrThrow(userId);

    const updatedCompany = await prisma.company.update({
      where: { id_company: companyId },
      data: {
        address: validatedData.address,
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        last_update: new Date()
      },
      select: {
        id_company: true,
        address: true,
        latitude: true,
        longitude: true,
        last_update: true
      }
    });

    const payload = {
      address: updatedCompany.address,
      latitude: updatedCompany.latitude,
      longitude: updatedCompany.longitude,
      lastUpdate: updatedCompany.last_update
    };

    invalidateDirectoryCache();

    return res.status(200).json({
      success: true,
      message: 'Géolocalisation mise à jour avec succès',
      data: payload,
      geolocation: payload
    });
  } catch (error) {
    console.error('❌ Erreur updateGeolocation:', error);
    if (error.name === 'ZodError') {
      return sendError(res, new HttpError(400, 'Données invalides', error.errors));
    }
    if (error instanceof HttpError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
};
