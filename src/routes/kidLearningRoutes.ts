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

// Courses
router.get('/courses', getMyCourses);
router.get('/courses/:courseId/content', getCourseContent);

// Lessons
router.get('/lessons/:lessonId', getLesson);
router.post('/lessons/:lessonId/submit', submitLesson);

export default router;