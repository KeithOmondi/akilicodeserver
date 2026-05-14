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
import { isAuthenticated } from '../middleware/authMiddleware';

const router = Router();

// All kid routes require kid authentication
router.use(isAuthenticated);

// Dashboard
router.get('/dashboard', getDashboardStats);
router.get('/leaderboard', getLeaderboard);
router.get('/achievements', getAchievements);

// Courses — entry point is enrollments now
router.get('/courses', getMyCourses);
router.get('/enrollments/:enrollmentId/content', getCourseContent);

// Lessons — scoped under enrollment
router.get('/enrollments/:enrollmentId/lessons/:lessonId', getLesson);
router.post('/enrollments/:enrollmentId/lessons/:lessonId/submit', submitLesson);

export default router;