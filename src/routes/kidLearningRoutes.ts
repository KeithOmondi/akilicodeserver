// routes/kidLearningRoutes.ts — everything here is for logged-in CHILDREN only.
import { Router } from 'express';
import {
  getMyCourses,
  getCourseContent,
  getLesson,
  submitLesson,
  getDashboardStats,
  getAchievements,
} from '../controllers/kidLearningController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { enforceScreenTime } from '../middleware/screenTime';
import { getLeaderboard as getNewLeaderboard } from '../controllers/leaderboardController';
import { validate } from '../middleware/validate';
import { enrollmentParam, lessonParams, submitLessonSchema } from '../validators/learning.validators';

const router = Router();

// Previously any logged-in user (parent/admin) could call these. Children only.
router.use(isAuthenticated, isAuthorized('kid'));

router.get('/dashboard', getDashboardStats);
router.get('/leaderboard', getNewLeaderboard);
router.get('/achievements', getAchievements);
router.get('/courses', getMyCourses);

// Lessons stop when the parent's daily screen-time limit is used up.
router.get('/courses/:enrollmentId/content', enforceScreenTime, validate(enrollmentParam, 'params'), getCourseContent);
router.get('/courses/:enrollmentId/lessons/:lessonId', enforceScreenTime, validate(lessonParams, 'params'), getLesson);
router.post(
  '/courses/:enrollmentId/lessons/:lessonId/submit',
  enforceScreenTime,
  validate(lessonParams, 'params'),
  validate(submitLessonSchema),
  submitLesson
);

export default router;
