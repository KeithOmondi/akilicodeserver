// src/routes/CodePlaygroundRoutes.ts

import { Router } from 'express';
import codeExecutionController from '../controllers/CodePlaygroundController'; // or your actual controller file
import { isAuthenticated } from '../middleware/authMiddleware';

const router = Router();

// ==================== Code Execution ====================
// Main endpoint to execute code (supports javascript, python, html, css)
router.post('/execute', isAuthenticated, codeExecutionController.executeCode.bind(codeExecutionController));

// ==================== Docker & System Health ====================
// Docker health check – useful for monitoring and debugging
router.get('/docker/health', isAuthenticated, codeExecutionController.getDockerHealth.bind(codeExecutionController));

// Execution system status – shows Docker availability, Node version, etc.
router.get('/status', isAuthenticated, (req, res) => {
  res.json({
    success: true,
    data: {
      dockerEnabled: process.env.USE_DOCKER_EXECUTION === 'true',
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      supportedLanguages: ['javascript', 'python', 'html', 'css']
    }
  });
});

// ==================== Admin Routes ====================
// Emergency stop – kill all running executions (Docker + local)
router.delete('/admin/executions/kill-all', 
  isAuthenticated, 
  codeExecutionController.killAllExecutions.bind(codeExecutionController)
);

// Get detailed stats: active executions, Docker status
router.get('/admin/docker/stats', 
  isAuthenticated, 
  async (req, res) => {
    try {
      const dockerEnabled = process.env.USE_DOCKER_EXECUTION === 'true';
      let activeExecutions = 0;
      
      if (dockerEnabled && (codeExecutionController as any)['dockerService']) {
        activeExecutions = await (codeExecutionController as any)['dockerService'].getActiveExecutions();
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

// Maintenance: force-clean all Docker containers (useful if stuck)
router.post('/admin/docker/cleanup',
  isAuthenticated,
  async (req, res) => {
    try {
      const dockerEnabled = process.env.USE_DOCKER_EXECUTION === 'true';
      
      if (dockerEnabled && (codeExecutionController as any)['dockerService']) {
        await (codeExecutionController as any)['dockerService'].killAllExecutions();
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