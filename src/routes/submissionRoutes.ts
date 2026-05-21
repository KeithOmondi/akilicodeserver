// src/routes/submissionRoutes.ts
import { Router } from 'express';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import {
  submitAssignment,
  getMySubmissions,
  getSubmissionByLesson,
  getAllSubmissions,
  getSubmissionsByLesson,
  reviewSubmission,
} from '../controllers/submissionController';

const router = Router();

// ─── Kid routes ────────────────────────────────────────────────────────────
router.post('/', isAuthenticated, isAuthorized('kid'), submitAssignment);
router.get('/enrollment/:enrollmentId', isAuthenticated, isAuthorized('kid'), getMySubmissions);
router.get('/lesson/:lessonId', isAuthenticated, isAuthorized('kid'), getSubmissionByLesson);

// ─── Admin routes ──────────────────────────────────────────────────────────
router.get('/', isAuthenticated, isAuthorized('admin'), getAllSubmissions);
router.get('/lesson/:lessonId/all', isAuthenticated, isAuthorized('admin'), getSubmissionsByLesson);
router.patch('/:submissionId/review', isAuthenticated, isAuthorized('admin'), reviewSubmission);

export default router;