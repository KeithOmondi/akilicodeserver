// routes/kidLearningRoutes.ts
import { Router } from 'express';
import {
  getMyCourses,
  getCourseContent,
  getLesson,
  submitLesson,
  getDashboardStats,
  getLeaderboard,
  getAchievements
} from '../controllers/kidLearningController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// All kid routes require authentication
router.use(isAuthenticated);

// Dashboard
router.get('/dashboard', getDashboardStats);
router.get('/leaderboard', getLeaderboard);
router.get('/achievements', getAchievements);

// Enrolled courses
router.get('/courses', getMyCourses);

// Course content (modules & lessons) for a specific enrollment
// ✅ Changed from /enrollments/:enrollmentId/content to /courses/:enrollmentId/content
router.get('/courses/:enrollmentId/content', isAuthorized('kid'), getCourseContent);

// Single lesson details – also under /courses
router.get('/courses/:enrollmentId/lessons/:lessonId', getLesson);
router.post('/courses/:enrollmentId/lessons/:lessonId/submit', submitLesson);

export default router;