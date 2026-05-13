// src/routes/CodePlaygroundRoutes.ts

import { Router } from 'express';
import codePlaygroundController from '../controllers/CodePlaygroundController';
import { isAuthenticated } from '../middleware/authMiddleware';

const router = Router();

// ==================== Snippet Routes ====================
router.post('/snippets', isAuthenticated, codePlaygroundController.createSnippet.bind(codePlaygroundController));
router.get('/snippets', isAuthenticated, codePlaygroundController.getUserSnippets.bind(codePlaygroundController));
router.get('/snippets/:id', isAuthenticated, codePlaygroundController.getSnippet.bind(codePlaygroundController));
router.put('/snippets/:id', isAuthenticated, codePlaygroundController.updateSnippet.bind(codePlaygroundController));
router.delete('/snippets/:id', isAuthenticated, codePlaygroundController.deleteSnippet.bind(codePlaygroundController));
router.post('/snippets/:id/favorite', isAuthenticated, codePlaygroundController.toggleFavorite.bind(codePlaygroundController));

// ==================== Code Execution Routes ====================
router.post('/execute', isAuthenticated, codePlaygroundController.executeCode.bind(codePlaygroundController));
router.get('/executions/:snippetId', isAuthenticated, codePlaygroundController.getExecutionHistory.bind(codePlaygroundController));

// ==================== Session Routes ====================
router.post('/session', codePlaygroundController.saveSession.bind(codePlaygroundController));
router.get('/session', codePlaygroundController.getSession.bind(codePlaygroundController));

// ==================== Search & Analytics Routes ====================
router.get('/search', isAuthenticated, codePlaygroundController.searchSnippets.bind(codePlaygroundController));
router.get('/stats', isAuthenticated, codePlaygroundController.getStats.bind(codePlaygroundController));

// ==================== Share Routes ====================
router.post('/snippets/:id/share', isAuthenticated, codePlaygroundController.generateShareLink.bind(codePlaygroundController));
router.get('/shared/:token', codePlaygroundController.getSharedSnippet.bind(codePlaygroundController));

export default router;