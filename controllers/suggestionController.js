const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();
const { z } = require('zod');
const { normalizeArrayParam } = require('../lib/params');
const { haversineDistance } = require('../lib/geo');

const SCORE_WEIGHTS = {
  resource: 40,
  proximity: 30,
  quantity: 20,
  sector: 10
};

const MAX_DISTANCE_SCORE_KM = 50;
const MIN_SUGGESTION_SCORE = 30;
const DEFAULT_SUGGESTION_LIMIT = 25;
const NEW_SUGGESTION_WINDOW_DAYS = 7;
const DIRECTORY_ALLOWED_STATUSES = ['validated', 'approved', 'active'];

const SUGGESTION_STATUS = {
  NEW: 'new',
  SAVED: 'saved',
  IGNORED: 'ignored',
  CONTACTED: 'contacted'
};

const suggestionQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: z.enum(Object.values(SUGGESTION_STATUS)).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxDistance: z.coerce.number().positive().max(500).optional(),
  sort: z.enum(['score', 'distance', 'recent', 'alpha']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  includeIgnored: z.coerce.boolean().optional(),
  tags: z.string().optional()
}).passthrough();

const suggestionActionSchema = z.object({
  comment: z.string().trim().max(500).optional()
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toLower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : null);

 

const classifyCompatibility = (score) => {
  if (score >= 85) {
    return { label: 'Très forte compatibilité', badge: 'top', color: 'emerald' };
  }
  if (score >= 70) {
    return { label: 'Compatibilité élevée', badge: 'high', color: 'green' };
  }
  if (score >= 50) {
    return { label: 'Compatibilité moyenne', badge: 'medium', color: 'amber' };
  }
  return { label: 'Compatibilité limitée', badge: 'low', color: 'gray' };
};

const isFreshInteraction = (interaction) => {
  if (!interaction?.created_at) return false;
  const created = new Date(interaction.created_at);
  const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= NEW_SUGGESTION_WINDOW_DAYS;
};

const extractCompanyContext = (company) => {
  const outputs = company.outputs || [];
  const inputs = company.inputs || [];
  const companyTypes = company.companyTypes || [];

  const productions = outputs.filter((output) => !output.is_been);
  const wastes = outputs.filter((output) => output.is_been);

  return {
    productions,
    wastes,
    inputs,
    tags: Array.from(new Set([
      company.sector,
      ...companyTypes.map((ct) => ct.type?.name).filter(Boolean),
      ...wastes.map((waste) => waste.family?.name || waste.category).filter(Boolean)
    ].filter(Boolean))),
    typeSet: new Set(companyTypes.map((ct) => toLower(ct.type?.name)).filter(Boolean))
  };
};

const buildResourceDescriptor = (resource, kind) => ({
  id: resource.id_output || resource.id_input,
  name: resource.name,
  category: toLower(resource.category),
  family: toLower(resource.family?.name),
  unit: toLower(resource.unit_measure),
  type: kind,
  raw: resource
});

const collectResources = (company) => {
  const context = extractCompanyContext(company);

  return {
    productions: context.productions.map((item) => buildResourceDescriptor(item, 'production')),
    wastes: context.wastes.map((item) => buildResourceDescriptor(item, 'waste')),
    inputs: context.inputs.map((item) => buildResourceDescriptor(item, 'need')),
    tags: context.tags,
    typeSet: context.typeSet
  };
};

const matchResources = (offers, needs) => {
  const matches = [];

  offers.forEach((offer) => {
    needs.forEach((need) => {
      let strength = 0;
      let matchType = null;

      if (offer.family && need.family && offer.family === need.family) {
        strength = 1;
        matchType = 'family';
      } else if (offer.category && need.category && offer.category === need.category) {
        strength = 0.75;
        matchType = 'category';
      } else if (offer.name && need.name && toLower(offer.name) === toLower(need.name)) {
        strength = 0.5;
        matchType = 'name';
      }

      if (strength > 0) {
        const unitMatch = offer.unit && need.unit && offer.unit === need.unit;
        matches.push({
          offer,
          need,
          strength,
          matchType,
          unitMatch
        });
      }
    });
  });

  return matches;
};

const computeResourceScore = (matches, offersCount, needsCount) => {
  if (!matches.length) return { score: 0, detail: 0 };
  const denominator = Math.max(offersCount, needsCount, 1);
  const totalStrength = matches.reduce((sum, match) => sum + match.strength, 0);
  const normalized = clamp(totalStrength / denominator, 0, 1);
  const score = Math.round(normalized * SCORE_WEIGHTS.resource);
  return { score, detail: Math.round(normalized * 100) };
};

const computeQuantityScore = (matches) => {
  if (!matches.length) return { score: 0, matched: 0 };
  const unitMatches = matches.filter((match) => match.unitMatch).length;
  if (unitMatches === 0) {
    return { score: Math.round(SCORE_WEIGHTS.quantity * 0.4), matched: 0 };
  }
  const ratio = clamp(unitMatches / matches.length, 0, 1);
  const score = Math.round(SCORE_WEIGHTS.quantity * (0.6 + 0.4 * ratio));
  return { score, matched: unitMatches };
};

const computeProximityScore = (distanceKm) => {
  if (distanceKm === null || Number.isNaN(distanceKm)) {
    return { score: 0 };
  }
  if (distanceKm <= 5) {
    return { score: SCORE_WEIGHTS.proximity };
  }
  if (distanceKm >= MAX_DISTANCE_SCORE_KM) {
    return { score: 0 };
  }
  const effectiveRange = MAX_DISTANCE_SCORE_KM - 5;
  const remaining = clamp(MAX_DISTANCE_SCORE_KM - distanceKm, 0, effectiveRange);
  const ratio = remaining / effectiveRange;
  const score = Math.round(ratio * SCORE_WEIGHTS.proximity);
  return { score };
};

const computeSectorScore = (source, target) => {
  const intersection = new Set();
  source.typeSet.forEach((type) => {
    if (type && target.typeSet.has(type)) {
      intersection.add(type);
    }
  });

  if (intersection.size > 0) {
    return { score: SCORE_WEIGHTS.sector, sharedTypes: Array.from(intersection) };
  }

  if (source.tags.some((tag) => target.tags.includes(tag))) {
    return { score: Math.round(SCORE_WEIGHTS.sector * 0.7), sharedTypes: [] };
  }

  if (source.tags.length && target.tags.length) {
    return { score: Math.round(SCORE_WEIGHTS.sector * 0.4), sharedTypes: [] };
  }

  return { score: 0, sharedTypes: [] };
};

const buildReasons = ({
  company,
  candidate,
  forwardMatches,
  backwardMatches,
  distanceKm,
  sectorInfo
}) => {
  const reasons = [];

  const describeMatch = (match, direction) => {
    const offerName = match.offer.raw.name;
    const needName = match.need.raw.name;
    const label = direction === 'forward'
      ? `Vos ${offerName} répondent au besoin en ${needName} de ${candidate.name}`
      : `Leur ${offerName} peut couvrir votre besoin en ${needName}`;
    const extra = match.matchType === 'family'
      ? ' (famille identique)'
      : match.matchType === 'category'
        ? ' (catégorie compatible)'
        : '';
    return `${label}${extra}`;
  };

  forwardMatches.slice(0, 2).forEach((match) => {
    reasons.push({ type: 'resource', message: describeMatch(match, 'forward') });
  });
  backwardMatches.slice(0, 2).forEach((match) => {
    reasons.push({ type: 'resource', message: describeMatch(match, 'backward') });
  });

  if (distanceKm !== null) {
    if (distanceKm <= 5) {
      reasons.push({ type: 'proximity', message: `Proximité immédiate (${distanceKm.toFixed(1)} km)` });
    } else if (distanceKm <= 25) {
      reasons.push({ type: 'proximity', message: `Transport optimisé (${distanceKm.toFixed(1)} km)` });
    }
  }

  if (sectorInfo.sharedTypes?.length) {
    reasons.push({
      type: 'sector',
      message: `Expertise commune: ${sectorInfo.sharedTypes.join(', ')}`
    });
  } else if (company.sector && candidate.sector && company.sector !== candidate.sector) {
    reasons.push({
      type: 'sector',
      message: `Secteurs complémentaires: ${company.sector} ↔ ${candidate.sector}`
    });
  }

  if (forwardMatches.some((match) => match.unitMatch) || backwardMatches.some((match) => match.unitMatch)) {
    reasons.push({
      type: 'quantity',
      message: 'Volumes et unités compatibles pour lancer rapidement une collaboration'
    });
  }

  if (!reasons.length) {
    reasons.push({ type: 'insight', message: `${candidate.name} partage plusieurs points clés avec votre activité.` });
  }

  return reasons;
};

const applyFilters = (suggestions, filters) => {
  return suggestions.filter((suggestion) => {
    if (!filters.includeIgnored && suggestion.status === SUGGESTION_STATUS.IGNORED) {
      return false;
    }

    if (filters.status && suggestion.status !== filters.status) {
      return false;
    }

    if (filters.minScore !== undefined && suggestion.compatibility.score < filters.minScore) {
      return false;
    }

    if (filters.maxDistance !== undefined && suggestion.distanceKm !== null && suggestion.distanceKm > filters.maxDistance) {
      return false;
    }

    if (filters.tags?.length) {
      const suggestionTags = new Set(suggestion.tags.map((tag) => tag.toLowerCase()));
      const hasTag = filters.tags.some((tag) => suggestionTags.has(tag.toLowerCase()));
      if (!hasTag) {
        return false;
      }
    }

    if (filters.search) {
      const haystack = [
        suggestion.company.name,
        suggestion.company.sector,
        ...suggestion.tags,
        ...suggestion.reasons.map((reason) => reason.message)
      ].join(' ').toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
};

const sortSuggestions = (suggestions, sortMode) => {
  const sorted = [...suggestions];

  switch (sortMode) {
    case 'distance':
      sorted.sort((a, b) => {
        const distA = a.distanceKm ?? Number.POSITIVE_INFINITY;
        const distB = b.distanceKm ?? Number.POSITIVE_INFINITY;
        if (distA !== distB) return distA - distB;
        return b.compatibility.score - a.compatibility.score;
      });
      break;
    case 'recent':
      sorted.sort((a, b) => new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime());
      break;
    case 'alpha':
      sorted.sort((a, b) => a.company.name.localeCompare(b.company.name));
      break;
    case 'score':
    default:
      sorted.sort((a, b) => {
        const diff = b.compatibility.score - a.compatibility.score;
        if (diff !== 0) return diff;
        const distA = a.distanceKm ?? Number.POSITIVE_INFINITY;
        const distB = b.distanceKm ?? Number.POSITIVE_INFINITY;
        return distA - distB;
      });
      break;
  }

  return sorted;
};

const buildStats = (suggestions) => {
  const activeSuggestions = suggestions.filter((suggestion) => suggestion.status !== SUGGESTION_STATUS.IGNORED);
  const newSuggestions = activeSuggestions.filter((suggestion) => suggestion.status === SUGGESTION_STATUS.NEW);
  const awaitingResponse = activeSuggestions.filter((suggestion) => [SUGGESTION_STATUS.NEW, SUGGESTION_STATUS.SAVED].includes(suggestion.status));

  const compatibilityAverage = activeSuggestions.length
    ? Math.round(activeSuggestions.reduce((sum, suggestion) => sum + suggestion.compatibility.score, 0) / activeSuggestions.length)
    : 0;

  const compatibilityDistribution = {
    high: activeSuggestions.filter((suggestion) => suggestion.compatibility.score >= 80).length,
    medium: activeSuggestions.filter((suggestion) => suggestion.compatibility.score >= 60 && suggestion.compatibility.score < 80).length,
    low: activeSuggestions.filter((suggestion) => suggestion.compatibility.score < 60).length
  };

  const statusBreakdown = Object.values(SUGGESTION_STATUS).reduce((acc, status) => {
    acc[status] = suggestions.filter((suggestion) => suggestion.status === status).length;
    return acc;
  }, {});

  return {
    summary: {
      active: activeSuggestions.length,
      newThisWeek: newSuggestions.filter((suggestion) => suggestion.meta.isFresh).length,
      awaitingResponse: awaitingResponse.length
    },
    compatibility: {
      average: compatibilityAverage,
      distribution: compatibilityDistribution,
      bestScore: activeSuggestions.reduce((max, suggestion) => Math.max(max, suggestion.compatibility.score), 0)
    },
    status: statusBreakdown
  };
};

const buildFiltersPayload = (suggestions) => {
  const sectors = new Map();
  const tags = new Map();

  suggestions.forEach((suggestion) => {
    if (suggestion.status === SUGGESTION_STATUS.IGNORED) return;

    const sector = suggestion.company.sector;
    if (sector) {
      sectors.set(sector, (sectors.get(sector) || 0) + 1);
    }

    suggestion.tags.forEach((tag) => {
      if (!tag) return;
      tags.set(tag, (tags.get(tag) || 0) + 1);
    });
  });

  const mapToArray = (map) => Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));

  return {
    status: Object.values(SUGGESTION_STATUS).map((status) => ({ value: status })),
    compatibility: [
      { label: 'Très forte (≥ 85%)', minScore: 85 },
      { label: 'Élevée (70-84%)', minScore: 70 },
      { label: 'Moyenne (50-69%)', minScore: 50 }
    ],
    distance: [
      { label: '≤ 5 km', maxDistance: 5 },
      { label: '≤ 15 km', maxDistance: 15 },
      { label: '≤ 30 km', maxDistance: 30 }
    ],
    sectors: mapToArray(sectors),
    tags: mapToArray(tags)
  };
};

async function ensureInteractionRecord(userId, companyId, payload, existingInteraction) {
  const mergedMetadata = existingInteraction?.metadata
    ? {
        ...existingInteraction.metadata,
        ...(payload.metadata || {}),
        components: payload.metadata?.components,
        rawScores: payload.metadata?.rawScores,
        computedAt: payload.metadata?.computedAt
      }
    : payload.metadata;

  return prisma.suggestionInteraction.upsert({
    where: {
      user_id_target_company_id: {
        user_id: userId,
        target_company_id: companyId
      }
    },
    create: {
      user_id: userId,
      target_company_id: companyId,
      status: SUGGESTION_STATUS.NEW,
      last_score: payload.lastScore,
      distance_km: payload.distanceKm,
      reasons: payload.reasons,
      metadata: mergedMetadata
    },
    update: {
      last_score: payload.lastScore,
      distance_km: payload.distanceKm,
      reasons: payload.reasons,
      metadata: mergedMetadata
    }
  });
}

async function computeSuggestions(userId, { persist = true } = {}) {
  const company = await prisma.company.findFirst({
    where: { owner_id: userId },
    include: {
      companyTypes: { include: { type: true } },
      outputs: { include: { family: true } },
      inputs: { include: { family: true } }
    }
  });

  if (!company) {
    return { company: null, suggestions: [], interactions: new Map() };
  }

  const interactionsList = await prisma.suggestionInteraction.findMany({
    where: { user_id: userId },
    select: {
      id_suggestion: true,
      target_company_id: true,
      status: true,
      reasons: true,
      metadata: true,
      last_score: true,
      distance_km: true,
      created_at: true,
      updated_at: true
    }
  });

  const interactions = new Map(interactionsList.map((interaction) => [interaction.target_company_id, interaction]));

  const candidates = await prisma.company.findMany({
    where: {
      id_company: { not: company.id_company },
      validation_status: DIRECTORY_ALLOWED_STATUSES.length ? { in: DIRECTORY_ALLOWED_STATUSES } : undefined
    },
    include: {
      companyTypes: { include: { type: true } },
      outputs: { include: { family: true } },
      inputs: { include: { family: true } }
    }
  });

  const sourceResources = collectResources(company);

  const suggestions = [];

  for (const candidate of candidates) {
    const targetResources = collectResources(candidate);

    const forwardMatches = matchResources(
      [...sourceResources.productions, ...sourceResources.wastes],
      targetResources.inputs
    );
    const backwardMatches = matchResources(
      [...targetResources.productions, ...targetResources.wastes],
      sourceResources.inputs
    );

    const allMatches = forwardMatches.concat(backwardMatches);

    if (!allMatches.length) {
      continue;
    }

    const distanceKm = haversineDistance(
      company.latitude,
      company.longitude,
      candidate.latitude,
      candidate.longitude
    );

    const resourceScore = computeResourceScore(
      allMatches,
      sourceResources.productions.length + sourceResources.wastes.length,
      sourceResources.inputs.length + targetResources.inputs.length
    );
    const quantityScore = computeQuantityScore(allMatches);
    const proximityScore = computeProximityScore(distanceKm);
    const sectorScore = computeSectorScore(sourceResources, targetResources);

    const totalScore = clamp(
      resourceScore.score + quantityScore.score + proximityScore.score + sectorScore.score,
      0,
      100
    );

    if (totalScore < MIN_SUGGESTION_SCORE) {
      continue;
    }

    const classification = classifyCompatibility(totalScore);

    const existingInteraction = interactions.get(candidate.id_company);

    const metadata = {
      components: {
        resource: resourceScore.score,
        quantity: quantityScore.score,
        proximity: proximityScore.score,
        sector: sectorScore.score
      },
      rawScores: {
        resourceMatchDetail: resourceScore.detail,
        quantityMatches: quantityScore.matched,
        sharedSectorTags: sectorScore.sharedTypes
      },
      computedAt: new Date().toISOString()
    };

    const reasons = buildReasons({
      company,
      candidate,
      forwardMatches,
      backwardMatches,
      distanceKm,
      sectorInfo: sectorScore
    });

    if (persist) {
      await ensureInteractionRecord(userId, candidate.id_company, {
        lastScore: totalScore,
        distanceKm,
        reasons,
        metadata
      }, existingInteraction);
    }

    const status = existingInteraction?.status || SUGGESTION_STATUS.NEW;

    suggestions.push({
      company: {
        id: candidate.id_company,
        name: candidate.name,
        sector: candidate.sector,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude
      },
      status,
      interactionId: existingInteraction?.id_suggestion || null,
      distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
      compatibility: {
        score: totalScore,
        label: classification.label,
        badge: classification.badge,
        color: classification.color,
        breakdown: metadata.components
      },
      tags: Array.from(new Set([
        candidate.sector,
        ...targetResources.tags
      ].filter(Boolean))),
      reasons,
      matches: {
        forward: forwardMatches,
        backward: backwardMatches
      },
      meta: {
        isFresh: existingInteraction ? isFreshInteraction(existingInteraction) : true,
        createdAt: existingInteraction?.created_at || new Date().toISOString(),
        updatedAt: existingInteraction?.updated_at || new Date().toISOString()
      }
    });
  }

  return { company, suggestions, interactions };
}

exports.getSuggestions = async (req, res) => {
  try {
    const filtersRaw = suggestionQuerySchema.safeParse(req.query);
    if (!filtersRaw.success) {
      return res.status(400).json({
        error: 'Paramètres invalides',
        details: filtersRaw.error.flatten()
      });
    }

    const filters = filtersRaw.data;
    const tags = normalizeArrayParam(filters.tags);

    const { company, suggestions } = await computeSuggestions(req.user.userId, { persist: true });

    if (!company) {
      return res.status(404).json({
        error: 'Entreprise non trouvée',
        message: 'Créez votre profil entreprise pour recevoir des suggestions'
      });
    }

    const appliedFilters = {
      search: filters.search ?? null,
      status: filters.status ?? null,
      minScore: filters.minScore ?? null,
      maxDistance: filters.maxDistance ?? null,
      includeIgnored: Boolean(filters.includeIgnored),
      tags
    };

    const filtered = applyFilters(suggestions, { ...appliedFilters, tags });
    const sorted = sortSuggestions(filtered, filters.sort || 'score');
    const limit = filters.limit || DEFAULT_SUGGESTION_LIMIT;
    const limited = sorted.slice(0, limit);

    const stats = buildStats(suggestions);
    const filtersPayload = buildFiltersPayload(suggestions);

    return res.status(200).json({
      success: true,
      data: {
        suggestions: limited,
        stats,
        filters: filtersPayload,
        total: filtered.length,
        available: suggestions.length,
        appliedFilters,
        limit
      }
    });
  } catch (error) {
    console.error('❌ Erreur getSuggestions:', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur',
      message: 'Impossible de générer les suggestions pour le moment'
    });
  }
};

exports.getSuggestionStats = async (req, res) => {
  try {
    const { company, suggestions } = await computeSuggestions(req.user.userId, { persist: false });

    if (!company) {
      return res.status(404).json({
        error: 'Entreprise non trouvée',
        message: 'Créez votre profil entreprise pour consulter les statistiques'
      });
    }

    const stats = buildStats(suggestions);

    const bestMatches = sortSuggestions(suggestions.filter((suggestion) => suggestion.status !== SUGGESTION_STATUS.IGNORED), 'score')
      .slice(0, 3)
      .map((suggestion) => ({
        company: suggestion.company,
        score: suggestion.compatibility.score,
        distanceKm: suggestion.distanceKm,
        status: suggestion.status,
        label: suggestion.compatibility.label
      }));

    const engagement = {
      saved: suggestions.filter((suggestion) => suggestion.status === SUGGESTION_STATUS.SAVED).length,
      contacted: suggestions.filter((suggestion) => suggestion.status === SUGGESTION_STATUS.CONTACTED).length,
      ignored: suggestions.filter((suggestion) => suggestion.status === SUGGESTION_STATUS.IGNORED).length
    };

    return res.status(200).json({
      success: true,
      data: {
        stats,
        engagement,
        bestMatches
      }
    });
  } catch (error) {
    console.error('❌ Erreur getSuggestionStats:', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur',
      message: 'Impossible de calculer les statistiques'
    });
  }
};

exports.getSuggestionFilters = async (req, res) => {
  try {
    const { company, suggestions } = await computeSuggestions(req.user.userId, { persist: false });

    if (!company) {
      return res.status(404).json({
        error: 'Entreprise non trouvée',
        message: 'Créez votre profil entreprise pour accéder aux filtres'
      });
    }

    const filtersPayload = buildFiltersPayload(suggestions);

    return res.status(200).json({
      success: true,
      data: filtersPayload
    });
  } catch (error) {
    console.error('❌ Erreur getSuggestionFilters:', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur',
      message: 'Impossible de charger les filtres'
    });
  }
};

async function updateSuggestionStatus(req, res, targetStatus) {
  try {
    const paramsId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(paramsId) || paramsId <= 0) {
      return res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    }

    const body = suggestionActionSchema.safeParse(req.body || {});
    if (!body.success) {
      return res.status(400).json({ error: 'Payload invalide', details: body.error.flatten() });
    }

    const userId = req.user.userId;
    const existing = await prisma.suggestionInteraction.findUnique({
      where: {
        user_id_target_company_id: {
          user_id: userId,
          target_company_id: paramsId
        }
      }
    });

    let interaction;

    if (existing) {
      const nextMetadata = body.data.comment
        ? {
            ...(existing.metadata || {}),
            note: body.data.comment,
            updatedAt: new Date().toISOString()
          }
        : existing.metadata;

      interaction = await prisma.suggestionInteraction.update({
        where: { id_suggestion: existing.id_suggestion },
        data: {
          status: targetStatus,
          metadata: nextMetadata
        }
      });
    } else {
      const companyExists = await prisma.company.findUnique({
        where: { id_company: paramsId },
        select: { id_company: true }
      });

      if (!companyExists) {
        return res.status(404).json({ error: 'Entreprise non trouvée' });
      }

      interaction = await prisma.suggestionInteraction.create({
        data: {
          user_id: userId,
          target_company_id: paramsId,
          status: targetStatus,
          metadata: body.data.comment
            ? { note: body.data.comment, createdAt: new Date().toISOString() }
            : undefined
        }
      });
    }

    const response = {
      success: true,
      data: {
        status: targetStatus,
        interactionId: interaction.id_suggestion,
        updatedAt: interaction.updated_at
      }
    };

    if (targetStatus === SUGGESTION_STATUS.CONTACTED) {
      response.data.message = 'Contact initié avec succès';
    } else if (targetStatus === SUGGESTION_STATUS.SAVED) {
      response.data.message = 'Suggestion sauvegardée';
    } else if (targetStatus === SUGGESTION_STATUS.IGNORED) {
      response.data.message = 'Suggestion ignorée';
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('❌ Erreur updateSuggestionStatus:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}

exports.ignoreSuggestion = (req, res) => updateSuggestionStatus(req, res, SUGGESTION_STATUS.IGNORED);
exports.saveSuggestion = (req, res) => updateSuggestionStatus(req, res, SUGGESTION_STATUS.SAVED);
exports.contactSuggestion = (req, res) => updateSuggestionStatus(req, res, SUGGESTION_STATUS.CONTACTED);
