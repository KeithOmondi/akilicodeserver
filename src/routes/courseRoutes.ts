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
  addQuestion,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  // ✨ NEW assignment helpers
  getLessonAssignment,
  updateLessonAssignment,
} from '../controllers/lessonController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { getAllSubmissions, getMySubmissions, getSubmissionByLesson, getSubmissionsByLesson, reviewSubmission, submitAssignment } from '../controllers/submissionController';

const router = Router();

// ─── COURSES ──────────────────────────────────────────────────────────────────

router.get('/',       isAuthenticated, isAuthorized('parent', 'admin'), getAllCourses);
router.post('/create', isAuthenticated, isAuthorized('admin'),           createCourse);

// ─── CURRICULUM ───────────────────────────────────────────────────────────────

router.get('/:courseId/curriculum', isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getCourseCurriculum);

// ─── MODULES ──────────────────────────────────────────────────────────────────

router.get( '/:courseId/modules',      isAuthenticated, isAuthorized('parent', 'admin'), getModulesByCourse);
router.post('/modules/create',         isAuthenticated, isAuthorized('admin'),           createModule);
router.patch('/modules/:moduleId',     isAuthenticated, isAuthorized('admin'),           updateModule);
router.delete('/modules/:moduleId',    isAuthenticated, isAuthorized('admin'),           deleteModule);

// ─── LESSONS ──────────────────────────────────────────────────────────────────

router.get(   '/modules/:moduleId/lessons', isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getLessonsByModule);
router.get(   '/lessons/:lessonId',         isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getLessonById);
router.post(  '/lessons/create',            isAuthenticated, isAuthorized('admin'),                  createLesson);
router.patch( '/lessons/:lessonId',         isAuthenticated, isAuthorized('admin'),                  updateLesson);
router.delete('/lessons/:lessonId',         isAuthenticated, isAuthorized('admin'),                  deleteLesson);

// ✨ NEW ASSIGNMENT‑ONLY ROUTES (optional but convenient)
// Kid/parent can fetch just the assignment text without full lesson details
router.get(
  '/lessons/:lessonId/assignment',
  isAuthenticated, isAuthorized('parent', 'admin', 'kid'),
  getLessonAssignment
);
// Admin/tutor can update only the assignment field
router.patch(
  '/lessons/:lessonId/assignment',
  isAuthenticated, isAuthorized('admin'),
  updateLessonAssignment
);

// ─── QUIZ QUESTIONS ───────────────────────────────────────────────────────────
// Kids need GET access to questions; only admin can author them

router.get(   '/lessons/:lessonId/questions',   isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getQuestions);
router.post(  '/lessons/:lessonId/questions',   isAuthenticated, isAuthorized('admin'),                  addQuestion);
router.patch( '/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'),                  updateQuestion);
router.delete('/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'),                  deleteQuestion);



export default router;