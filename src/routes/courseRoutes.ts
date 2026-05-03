import { Router } from 'express';
import { createCourse, getAllCourses } from '../controllers/courseController';
import {
  createModule,
  getModulesByCourse,
  updateModule,
  deleteModule,
  createLesson,
  getLessonsByModule,
  getLessonById,
  updateLesson,
  deleteLesson,
  getCourseCurriculum,
} from '../controllers/lessonController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// ─── COURSES ──────────────────────────────────────────────────────────────────

router.get('/', isAuthenticated, isAuthorized('parent', 'admin'), getAllCourses);
router.post('/create', isAuthenticated, isAuthorized('admin'), createCourse);

// ─── CURRICULUM ───────────────────────────────────────────────────────────────

router.get('/:courseId/curriculum', isAuthenticated, isAuthorized('parent', 'admin'), getCourseCurriculum);

// ─── MODULES ──────────────────────────────────────────────────────────────────

router.get('/:courseId/modules', isAuthenticated, isAuthorized('parent', 'admin'), getModulesByCourse);
router.post('/modules/create', isAuthenticated, isAuthorized('admin'), createModule);
router.patch('/modules/:moduleId', isAuthenticated, isAuthorized('admin'), updateModule);
router.delete('/modules/:moduleId', isAuthenticated, isAuthorized('admin'), deleteModule);

// ─── LESSONS ──────────────────────────────────────────────────────────────────

router.get('/modules/:moduleId/lessons', isAuthenticated, isAuthorized('parent', 'admin'), getLessonsByModule);
router.get('/lessons/:lessonId', isAuthenticated, isAuthorized('parent', 'admin'), getLessonById);
router.post('/lessons/create', isAuthenticated, isAuthorized('admin'), createLesson);
router.patch('/lessons/:lessonId', isAuthenticated, isAuthorized('admin'), updateLesson);
router.delete('/lessons/:lessonId', isAuthenticated, isAuthorized('admin'), deleteLesson);

export default router;