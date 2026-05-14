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

// ==================== Docker & System Health Routes ====================
// Docker health check - useful for monitoring and debugging
router.get('/docker/health', isAuthenticated, codePlaygroundController.getDockerHealth.bind(codePlaygroundController));

// Docker execution status - check if Docker is enabled
router.get('/status', isAuthenticated, (req, res) => {
  res.json({
    success: true,
    data: {
      dockerEnabled: process.env.USE_DOCKER_EXECUTION === 'true',
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

// ==================== Admin Routes ====================
// Kill all running executions - emergency stop
router.delete('/admin/executions/kill-all', 
  isAuthenticated, 
  codePlaygroundController.killAllExecutions.bind(codePlaygroundController)
);

// Get Docker stats and active executions
router.get('/admin/docker/stats', 
  isAuthenticated, 
  async (req, res) => {
    try {
      // Use the getDockerHealth method which handles null case
      const dockerEnabled = process.env.USE_DOCKER_EXECUTION === 'true';
      let activeExecutions = 0;
      
      if (dockerEnabled && codePlaygroundController['dockerService']) {
        activeExecutions = await codePlaygroundController['dockerService'].getActiveExecutions();
      }
      
      res.json({
        success: true,
        data: {
          activeExecutions,
          dockerEnabled,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats'
      });
    }
  }
);

// Clean up all Docker containers (maintenance)
router.post('/admin/docker/cleanup',
  isAuthenticated,
  async (req, res) => {
    try {
      const dockerEnabled = process.env.USE_DOCKER_EXECUTION === 'true';
      
      if (dockerEnabled && codePlaygroundController['dockerService']) {
        await codePlaygroundController['dockerService'].killAllExecutions();
        res.json({
          success: true,
          message: 'All Docker containers cleaned up successfully'
        });
      } else {
        res.json({
          success: true,
          message: 'Docker is not enabled, no containers to clean up'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Cleanup failed'
      });
    }
  }
);

export default router;