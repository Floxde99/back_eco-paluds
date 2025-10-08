const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { z } = require('zod');
const { PrismaClient } = require('../generated/prisma/client');

const prisma = new PrismaClient();

const IMPORT_STORAGE_ROOT = process.env.IMPORT_STORAGE_DIR
  ? path.isAbsolute(process.env.IMPORT_STORAGE_DIR)
    ? process.env.IMPORT_STORAGE_DIR
    : path.join(__dirname, '..', process.env.IMPORT_STORAGE_DIR)
  : path.join(__dirname, '..', 'public', 'imports');

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.ods'];
const SUPPORTED_EXTENSIONS = ['.xlsx', '.csv'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

ensureDirectorySync(IMPORT_STORAGE_ROOT);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const userId = req.user?.userId;
      const targetDir = path.join(IMPORT_STORAGE_ROOT, String(userId || 'unknown'));
      ensureDirectorySync(targetDir);
      cb(null, targetDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    const safeExt = ALLOWED_EXTENSIONS.includes(ext.toLowerCase()) ? ext.toLowerCase() : '.xlsx';
    const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
    }
    cb(null, true);
  }
});

const importStatuses = {
  uploaded: 'UPLOADED',
  mapping: 'MAPPING',
  analyzing: 'ANALYZING',
  completed: 'COMPLETED',
  error: 'ERROR'
};

const analysisStatuses = {
  pending: 'PENDING',
  inProgress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  error: 'ERROR'
};

const historyStatus = {
  success: 'SUCCESS',
  warning: 'WARNING',
  error: 'ERROR'
};

const fieldNames = ['type', 'name', 'quantity', 'unit', 'frequency', 'status'];
const FieldEnum = z.enum(['type', 'name', 'quantity', 'unit', 'frequency', 'status']);

const fieldAliases = {
  type: ['type', 'categorie', 'category', 'resource type', 'type de donnee'],
  name: ['nom', 'name', 'designation', 'description', 'ressource'],
  quantity: ['quantite', 'quantity', 'volume', 'qte', 'amount'],
  unit: ['unite', 'unit', 'measure', 'unite de mesure'],
  frequency: ['frequence', 'frequency', 'periodicite', 'cycle'],
  status: ['etat', 'status', 'state', 'condition']
};

const mappingRequestSchema = z.object({
  mapping: z.union([
    z.literal('auto'),
    z.record(z.string().min(1), FieldEnum)
  ])
});

const mappingManualSchema = z.record(z.string().min(1), FieldEnum);

const syncRequestSchema = z.object({
  overwrite: z.boolean().optional()
}).passthrough();

function ensureDirectorySync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeString(value) {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function normalizeType(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (['dechet', 'waste', 'dechets'].includes(normalized)) {
    return 'waste';
  }
  if (['production', 'productions', 'output', 'sortie'].includes(normalized)) {
    return 'production';
  }
  if (['besoin', 'needs', 'need', 'input', 'approvisionnement'].includes(normalized)) {
    return 'need';
  }
  return normalized.includes('dechet') ? 'waste' : normalized.includes('besoin') ? 'need' : normalized;
}

function inferMapping(headers) {
  const mapping = {};
  headers.forEach((headerRaw) => {
    const normalized = normalizeString(headerRaw);
    Object.entries(fieldAliases).forEach(([field, aliases]) => {
      if (!mapping[field] && aliases.some((alias) => normalized.includes(alias))) {
        mapping[field] = headerRaw;
      }
    });
  });
  return mapping;
}

function resolveMapping(headers, mappingInput) {
  if (mappingInput === 'auto') {
    return inferMapping(headers);
  }

  const manualMapping = mappingManualSchema.safeParse(mappingInput);
  if (!manualMapping.success) {
    throw new Error('Mapping manuel invalide.');
  }

  const mapping = {};
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeString(header)
  }));

  Object.entries(manualMapping.data).forEach(([headerCandidate, field]) => {
    const normalizedCandidate = normalizeString(headerCandidate);
    const matched = normalizedHeaders.find((item) => item.normalized === normalizedCandidate || item.raw === headerCandidate);
    if (!matched) {
      throw new Error(`Colonne "${headerCandidate}" introuvable dans le fichier.`);
    }
    mapping[field] = matched.raw;
  });

  return mapping;
}

function buildFieldIndexes(headers, mapping) {
  const headerMap = new Map(headers.map((header, index) => [header, index]));
  const indexes = {};
  Object.entries(mapping).forEach(([field, header]) => {
    if (headerMap.has(header)) {
      indexes[field] = headerMap.get(header);
    }
  });
  return indexes;
}

function mapRowByIndexes(row, indexes) {
  const mapped = {};
  Object.entries(indexes).forEach(([field, index]) => {
    mapped[field] = row[index] !== undefined ? row[index] : null;
  });
  return mapped;
}

async function loadRowsFromFile(filePath, ext) {
  const extension = (ext || path.extname(filePath)).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error(`Le format ${extension} n'est pas encore pris en charge.`);
  }

  const workbook = new ExcelJS.Workbook();

  if (extension === '.csv') {
    const csv = await workbook.csv.readFile(filePath);
    const rows = [];
    csv.eachRow((row) => {
      rows.push(row.values.slice(1));
    });
    return rows;
  }

  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Le fichier est vide.');
  }
  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values.slice(1));
  });
  return rows;
}

function buildPreview(rows, indexes, limit = 10) {
  const preview = [];
  const dataRows = rows.slice(1);
  for (let i = 0; i < Math.min(limit, dataRows.length); i += 1) {
    const row = dataRows[i];
    const mapped = mapRowByIndexes(row, indexes);
    preview.push(mapped);
  }
  return preview;
}

function summariseDataset(dataset) {
  const totals = {
    production: { count: 0, quantity: 0 },
    waste: { count: 0, quantity: 0 },
    need: { count: 0, quantity: 0 }
  };

  dataset.forEach((item) => {
    const bucket = totals[item.type];
    if (!bucket) return;
    bucket.count += 1;
    const qty = Number(item.quantity);
    if (!Number.isNaN(qty)) {
      bucket.quantity += qty;
    }
  });

  return totals;
}

function buildAnalysisPayload(dataset, userId) {
  const totals = summariseDataset(dataset);
  const totalRows = dataset.length;
  const completeRows = dataset.filter((row) => row.type && row.name).length;
  const precision = totalRows === 0 ? 0 : Math.min(99, Math.round((completeRows / totalRows) * 10000) / 100);

  const predictions = [
    { label: 'Déchets mensuels', value: Math.round(totals.waste.quantity || 0) },
    { label: 'Productions mensuelles', value: Math.round(totals.production.quantity || 0) },
    { label: 'Besoins mensuels', value: Math.round(totals.need.quantity || 0) }
  ];

  const optimizations = buildOptimizations(totals);

  const financialImpact = buildFinancialImpact(totals);

  return {
    predictions,
    optimizations,
    financialImpact,
    precision,
    totals,
    rowsProcessed: totalRows,
    sourceData: dataset,
    userId
  };
}

function buildOptimizations(totals) {
  const optimizations = [];
  if (totals.waste.quantity > 0) {
    optimizations.push({ description: 'Optimiser le tri des déchets métalliques', impact: '+20% de valeur récupérée' });
  }
  if (totals.production.quantity > 0) {
    optimizations.push({ description: 'Planifier la production pour lisser les pics', impact: '-15% de stockage' });
  }
  if (totals.need.quantity > 0) {
    optimizations.push({ description: 'Sécuriser les approvisionnements critiques', impact: '+10% de disponibilité' });
  }
  if (!optimizations.length) {
    optimizations.push({ description: 'Complétez vos données pour générer des recommandations', impact: null });
  }
  return optimizations;
}

function buildFinancialImpact(totals) {
  const minRevenue = Math.round((totals.production.quantity || 0) * 60 + (totals.waste.quantity || 0) * 15);
  const maxRevenue = Math.round((totals.production.quantity || 0) * 90 + (totals.waste.quantity || 0) * 25);
  return {
    minRevenue,
    maxRevenue,
    breakdown: {
      production: Math.round((totals.production.quantity || 0) * 70),
      waste: Math.round((totals.waste.quantity || 0) * 20),
      optimization: Math.round((totals.need.quantity || 0) * 10)
    }
  };
}

async function buildPartnershipSuggestions(userId, limit = 4) {
  const interactions = await prisma.suggestionInteraction.findMany({
    where: { user_id: userId },
    include: {
      targetCompany: {
        select: {
          name: true,
          sector: true
        }
      }
    },
    orderBy: [
      { last_score: 'desc' },
      { updated_at: 'desc' }
    ],
    take: limit
  });

  if (interactions.length) {
    return interactions.map((interaction) => ({
      name: interaction.targetCompany?.name || 'Partenaire potentiel',
      sector: interaction.targetCompany?.sector || null,
      score: interaction.last_score || 70,
      compatibility: interaction.last_score ? `${interaction.last_score}%` : '70%'
    }));
  }

  return [
    { name: 'Partenaire local A', sector: 'Recyclage', score: 72, compatibility: '72%' },
    { name: 'Partenaire régional B', sector: 'Logistique', score: 68, compatibility: '68%' },
    { name: 'Partenaire Premium C', sector: 'Traitement', score: 81, compatibility: '81%' }
  ].slice(0, limit);
}

async function deleteFileSafe(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Impossible de supprimer le fichier', filePath, error);
    }
  }
}

function parseDataset(rows, indexes) {
  const dataRows = rows.slice(1);
  return dataRows.map((cells) => {
    const mapped = mapRowByIndexes(cells, indexes);
    const parsedQuantity = mapped.quantity && !Number.isNaN(Number(mapped.quantity)) ? Number(mapped.quantity) : null;
    return {
      type: normalizeType(mapped.type),
      name: mapped.name ? String(mapped.name).trim() : null,
      quantity: parsedQuantity,
      unit: mapped.unit ? String(mapped.unit).trim() : null,
      frequency: mapped.frequency ? String(mapped.frequency).trim() : null,
      status: mapped.status ? String(mapped.status).trim() : null,
      raw: mapped
    };
  }).filter((row) => row.type && row.name);
}

function enrichMetadata(existing = {}, additions = {}) {
  return {
    ...(existing || {}),
    ...additions,
    updatedAt: new Date().toISOString()
  };
}

async function loadImportFileOrThrow(fileId, userId) {
  const record = await prisma.importFile.findFirst({
    where: { id_import_file: fileId, user_id: userId }
  });
  if (!record) {
    const error = new Error('Fichier introuvable');
    error.status = 404;
    throw error;
  }
  return record;
}

async function loadAnalysisOrThrow(analysisId, userId) {
  const analysis = await prisma.importAnalysis.findFirst({
    where: { id_import_analysis: analysisId, user_id: userId },
    include: {
      file: true
    }
  });
  if (!analysis) {
    const error = new Error('Analyse introuvable');
    error.status = 404;
    throw error;
  }
  return analysis;
}

async function ensureUserCompany(userId) {
  const company = await prisma.company.findFirst({
    where: { owner_id: userId }
  });
  if (!company) {
    const error = new Error("Aucune entreprise associée à l'utilisateur");
    error.status = 404;
    throw error;
  }
  return company;
}

exports.uploadMiddleware = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Fichier trop volumineux (max 10 Mo).' });
      }
      return res.status(400).json({ error: err.message || 'Fichier invalide.' });
    }
    if (err) {
      console.error('❌ Erreur upload import:', err);
      return res.status(500).json({ error: "Impossible d'importer le fichier." });
    }
    next();
  });
};

exports.uploadImportFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu.' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      await deleteFileSafe(req.file.path);
      return res.status(400).json({ error: `Format ${ext} non supporté.` });
    }

    const importFile = await prisma.importFile.create({
      data: {
        user_id: req.user.userId,
        file_name: req.file.originalname,
        file_size: req.file.size,
        file_type: ext.replace('.', ''),
        file_path: path.normalize(req.file.path),
        status: importStatuses.uploaded,
        metadata: {
          mimetype: req.file.mimetype,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        fileId: importFile.id_import_file,
        fileName: importFile.file_name,
        fileSize: importFile.file_size,
        status: importFile.status
      }
    });
  } catch (error) {
    console.error('❌ uploadImportFile:', error);
    if (req.file) {
      await deleteFileSafe(req.file.path);
    }
    return res.status(error.status || 500).json({ error: error.message || "Erreur lors de l'upload." });
  }
};

exports.getImportStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalFiles, precisionAggregate, monthlyImports] = await Promise.all([
      prisma.importFile.count({ where: { user_id: userId } }),
      prisma.importAnalysis.aggregate({
        _avg: { precision_score: true },
        where: { user_id: userId, precision_score: { not: null } }
      }),
      prisma.importFile.count({ where: { user_id: userId, created_at: { gte: monthAgo } } })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalImports: totalFiles,
        precisionRate: precisionAggregate._avg.precision_score || 0,
        monthlyImports
      }
    });
  } catch (error) {
    console.error('❌ getImportStats:', error);
    return res.status(500).json({ error: "Impossible de charger les statistiques d'import." });
  }
};

exports.downloadTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Modèle');
    sheet.columns = [
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Nom', key: 'name', width: 32 },
      { header: 'Quantité', key: 'quantity', width: 14 },
      { header: 'Unité', key: 'unit', width: 12 },
      { header: 'Fréquence', key: 'frequency', width: 18 },
      { header: 'État', key: 'status', width: 18 }
    ];

    sheet.addRows([
      ['Déchet', 'Chutes métal', 500, 'kg', 'Mensuel', 'Propre'],
      ['Production', 'Pièces usinées', 200, 'unités', 'Mensuel', 'Fini'],
      ['Besoin', 'Aluminium', 2000, 'kg', 'Mensuel', 'Brut']
    ]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modele_import.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('❌ downloadTemplate:', error);
    res.status(500).json({ error: 'Impossible de générer le modèle.' });
  }
};

exports.mapColumns = async (req, res) => {
  try {
    const userId = req.user.userId;
    const fileId = Number.parseInt(req.params.fileId, 10);
    if (Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'Identifiant de fichier invalide.' });
    }

    const parsedBody = mappingRequestSchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Payload de mapping invalide.', details: parsedBody.error.flatten() });
    }

    const fileRecord = await loadImportFileOrThrow(fileId, userId);
    const rows = await loadRowsFromFile(fileRecord.file_path, `.${fileRecord.file_type}`);
    if (!rows.length) {
      return res.status(400).json({ error: 'Le fichier semble vide.' });
    }

    const headers = rows[0].map((cell) => (cell !== undefined && cell !== null ? String(cell) : 'Colonne')); 
    const mapping = resolveMapping(headers, parsedBody.data.mapping);
    if (!Object.keys(mapping).length) {
      return res.status(400).json({ error: 'Impossible de détecter automatiquement les colonnes.' });
    }

    const indexes = buildFieldIndexes(headers, mapping);
    const preview = buildPreview(rows, indexes);

    const metadata = enrichMetadata(fileRecord.metadata, {
      headers,
      mapping,
      indexes,
      preview,
      totalRows: rows.length - 1
    });

    await prisma.importFile.update({
      where: { id_import_file: fileRecord.id_import_file },
      data: {
        status: importStatuses.mapping,
        metadata
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        mappedColumns: mapping,
        preview
      }
    });
  } catch (error) {
    console.error('❌ mapColumns:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur de mapping.' });
  }
};

exports.launchAnalysis = async (req, res) => {
  const start = Date.now();
  try {
    const userId = req.user.userId;
    const fileId = Number.parseInt(req.params.fileId, 10);
    if (Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'Identifiant de fichier invalide.' });
    }

    const fileRecord = await loadImportFileOrThrow(fileId, userId);
    const metadata = fileRecord.metadata || {};
    if (!metadata.indexes) {
      return res.status(400).json({ error: 'Aucun mapping détecté. Veuillez mapper les colonnes avant analyse.' });
    }

    const rows = await loadRowsFromFile(fileRecord.file_path, `.${fileRecord.file_type}`);
    const dataset = parseDataset(rows, metadata.indexes);

    const analysisRecord = await prisma.importAnalysis.create({
      data: {
        file_id: fileRecord.id_import_file,
        user_id: userId,
        status: analysisStatuses.inProgress
      }
    });

    try {
      const analysisData = buildAnalysisPayload(dataset, userId);
      const partnerships = await buildPartnershipSuggestions(userId, 4);
      const duration = Date.now() - start;

      await prisma.importAnalysis.update({
        where: { id_import_analysis: analysisRecord.id_import_analysis },
        data: {
          status: analysisStatuses.completed,
          predictions: analysisData.predictions,
          optimizations: analysisData.optimizations,
          financial_impact: analysisData.financialImpact,
          partnerships,
          precision_score: analysisData.precision,
          processing_time_ms: duration,
          rows_processed: analysisData.rowsProcessed,
          source_data: analysisData.sourceData.slice(0, 500)
        }
      });

      const historyMetadata = {
        ...metadata,
        lastAnalysisId: analysisRecord.id_import_analysis,
        lastAnalysisAt: new Date().toISOString()
      };

      await prisma.importFile.update({
        where: { id_import_file: fileRecord.id_import_file },
        data: {
          status: importStatuses.completed,
          metadata: historyMetadata
        }
      });

      await prisma.importHistory.create({
        data: {
          file_id: fileRecord.id_import_file,
          analysis_id: analysisRecord.id_import_analysis,
          user_id: userId,
          name: `Analyse automatique - ${new Date().toLocaleDateString('fr-FR')}`,
          description: `Analyse IA générée à partir du fichier ${fileRecord.file_name}`,
          status: historyStatus.success,
          synced_to_profile: false
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          analysisId: analysisRecord.id_import_analysis,
          status: analysisStatuses.completed
        }
      });
    } catch (error) {
      await prisma.importAnalysis.update({
        where: { id_import_analysis: analysisRecord.id_import_analysis },
        data: {
          status: analysisStatuses.error,
          errors: { message: error.message }
        }
      });
      await prisma.importFile.update({
        where: { id_import_file: fileRecord.id_import_file },
        data: { status: importStatuses.error }
      });
      throw error;
    }
  } catch (error) {
    console.error('❌ launchAnalysis:', error);
    return res.status(error.status || 500).json({ error: error.message || "Erreur lors de l'analyse." });
  }
};

exports.getAnalysisPredictions = async (req, res) => {
  try {
    const analysis = await loadAnalysisOrThrow(Number.parseInt(req.params.analysisId, 10), req.user.userId);
    return res.status(200).json({
      success: true,
      data: {
        predictions: analysis.predictions || []
      }
    });
  } catch (error) {
    console.error('❌ getAnalysisPredictions:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer les prédictions.' });
  }
};

exports.getAnalysisPartnerships = async (req, res) => {
  try {
    const analysis = await loadAnalysisOrThrow(Number.parseInt(req.params.analysisId, 10), req.user.userId);
    return res.status(200).json({
      success: true,
      data: {
        partnerships: analysis.partnerships || []
      }
    });
  } catch (error) {
    console.error('❌ getAnalysisPartnerships:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer les partenariats.' });
  }
};

exports.getAnalysisOptimizations = async (req, res) => {
  try {
    const analysis = await loadAnalysisOrThrow(Number.parseInt(req.params.analysisId, 10), req.user.userId);
    return res.status(200).json({
      success: true,
      data: {
        optimizations: analysis.optimizations || []
      }
    });
  } catch (error) {
    console.error('❌ getAnalysisOptimizations:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer les optimisations.' });
  }
};

exports.getAnalysisImpact = async (req, res) => {
  try {
    const analysis = await loadAnalysisOrThrow(Number.parseInt(req.params.analysisId, 10), req.user.userId);
    return res.status(200).json({
      success: true,
      data: analysis.financial_impact || { minRevenue: 0, maxRevenue: 0, breakdown: {} }
    });
  } catch (error) {
    console.error('❌ getAnalysisImpact:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Impossible de récupérer l’impact financier.' });
  }
};

exports.syncAnalysisWithProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const analysisId = Number.parseInt(req.params.analysisId, 10);
    if (Number.isNaN(analysisId)) {
      return res.status(400).json({ error: 'Identifiant d’analyse invalide.' });
    }

    const analysis = await loadAnalysisOrThrow(analysisId, userId);
    const dataset = analysis.source_data;
    if (!dataset || !dataset.length) {
      return res.status(400).json({ error: 'Aucune donnée analysée disponible pour la synchronisation.' });
    }

    const company = await ensureUserCompany(userId);

    const result = { productions: 0, wastes: 0, needs: 0 };
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      for (const row of dataset) {
        if (!row.type || !row.name) continue;
        const description = buildDescriptionFromRow(row);
        if (row.type === 'production') {
          await tx.output.create({
            data: {
              name: row.name,
              category: row.type,
              is_been: false,
              unit_measure: row.unit || 'unité',
              description,
              status: row.status || 'active',
              company_id: company.id_company
            }
          });
          result.productions += 1;
        } else if (row.type === 'waste') {
          await tx.output.create({
            data: {
              name: row.name,
              category: row.type,
              is_been: true,
              unit_measure: row.unit || 'kg',
              description,
              status: row.status || 'à recycler',
              company_id: company.id_company
            }
          });
          result.wastes += 1;
        } else if (row.type === 'need') {
          await tx.input.create({
            data: {
              name: row.name,
              category: row.type,
              unit_measure: row.unit || 'unité',
              description,
              status: row.status || 'actif',
              company_id: company.id_company
            }
          });
          result.needs += 1;
        }
      }

      await tx.importHistory.updateMany({
        where: { analysis_id: analysisId, user_id: userId },
        data: {
          synced_to_profile: true,
          synced_at: now,
          status: historyStatus.success
        }
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        syncedItems: result
      }
    });
  } catch (error) {
    console.error('❌ syncAnalysisWithProfile:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Impossible de synchroniser les données.' });
  }
};

function buildDescriptionFromRow(row) {
  const parts = [];
  if (row.frequency) parts.push(`Fréquence: ${row.frequency}`);
  if (row.quantity) parts.push(`Quantité: ${row.quantity}`);
  return parts.length ? `Import automatique • ${parts.join(' | ')}` : 'Import automatique';
}

exports.getProfileSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
    const company = await prisma.company.findFirst({
      where: { owner_id: userId },
      select: { id_company: true }
    });

    const [productions, wastes, needs, analyses] = await Promise.all([
      company
        ? prisma.output.count({ where: { company_id: company.id_company, is_been: false } })
        : Promise.resolve(0),
      company
        ? prisma.output.count({ where: { company_id: company.id_company, is_been: true } })
        : Promise.resolve(0),
      company
        ? prisma.input.count({ where: { company_id: company.id_company } })
        : Promise.resolve(0),
      prisma.importAnalysis.count({ where: { user_id: userId } })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        productions,
        wastes,
        needs,
        analyses
      }
    });
  } catch (error) {
    console.error('❌ getProfileSummary:', error);
    return res.status(500).json({ error: 'Impossible de charger le résumé du profil.' });
  }
};

exports.getImportHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 30, 100);

    const items = await prisma.importHistory.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        file: {
          select: {
            file_name: true,
            status: true
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item.id_import_history,
          name: item.name,
          description: item.description,
          status: item.status,
          createdAt: item.created_at,
          fileName: item.file?.file_name || null,
          fileStatus: item.file?.status || null,
          syncedToProfile: item.synced_to_profile,
          syncedAt: item.synced_at
        }))
      }
    });
  } catch (error) {
    console.error('❌ getImportHistory:', error);
    return res.status(500).json({ error: "Impossible de charger l'historique." });
  }
};
