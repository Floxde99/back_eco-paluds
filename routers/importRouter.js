const express = require('express');
const authGuard = require('../services/authGuard');
const importController = require('../controllers/importController');

const router = express.Router();

router.post(
  '/upload',
  authGuard,
  importController.uploadMiddleware,
  importController.uploadImportFile
);

router.get('/stats', authGuard, importController.getImportStats);
router.get('/template', authGuard, importController.downloadTemplate);
router.post('/:fileId/map', authGuard, importController.mapColumns);
router.post('/:fileId/analyze', authGuard, importController.launchAnalysis);

router.get(
  '/analysis/:analysisId/predictions',
  authGuard,
  importController.getAnalysisPredictions
);
router.get(
  '/analysis/:analysisId/partnerships',
  authGuard,
  importController.getAnalysisPartnerships
);
router.get(
  '/analysis/:analysisId/optimizations',
  authGuard,
  importController.getAnalysisOptimizations
);
router.get('/analysis/:analysisId/impact', authGuard, importController.getAnalysisImpact);
router.post(
  '/analysis/:analysisId/sync',
  authGuard,
  importController.syncAnalysisWithProfile
);

router.get('/profile-summary', authGuard, importController.getProfileSummary);
router.get('/history', authGuard, importController.getImportHistory);

module.exports = router;
