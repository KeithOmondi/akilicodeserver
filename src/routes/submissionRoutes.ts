// src/routes/submissionRoutes.ts
import { Router } from 'express';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { enforceScreenTime } from '../middleware/screenTime';
import { validate } from '../middleware/validate';
import {
  submitAssignment,
  getMySubmissions,
  getSubmissionByLesson,
  getAllSubmissions,
  getSubmissionsByLesson,
  reviewSubmission,
} from '../controllers/submissionController';
import {
  submitAssignmentSchema,
  enrollmentParam,
  lessonIdParam,
  reviewSubmissionSchema,
  submissionIdParam,
  adminSubmissionsQuery,
} from '../validators/learning.validators';

const router = Router();

// ─── Kid routes ────────────────────────────────────────────────────────────
router.post('/', isAuthenticated, isAuthorized('kid'), enforceScreenTime, validate(submitAssignmentSchema), submitAssignment);
router.get('/enrollment/:enrollmentId', isAuthenticated, isAuthorized('kid'), validate(enrollmentParam, 'params'), getMySubmissions);
router.get('/lesson/:lessonId', isAuthenticated, isAuthorized('kid'), validate(lessonIdParam, 'params'), getSubmissionByLesson);

// ─── Admin routes ──────────────────────────────────────────────────────────
router.get('/', isAuthenticated, isAuthorized('admin'), validate(adminSubmissionsQuery, 'query'), getAllSubmissions);
router.get('/lesson/:lessonId/all', isAuthenticated, isAuthorized('admin'), validate(lessonIdParam, 'params'), getSubmissionsByLesson);
router.patch(
  '/:submissionId/review',
  isAuthenticated, isAuthorized('admin'),
  validate(submissionIdParam, 'params'), validate(reviewSubmissionSchema),
  reviewSubmission
);

export default router;
