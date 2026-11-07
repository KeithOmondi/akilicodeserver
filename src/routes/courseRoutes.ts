import { Router } from 'express';
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
  getLessonAssignment,
  updateLessonAssignment,
  submitQuiz,
  getAllCourses,
  createCourse,                // ✨ NEW – quiz submission
  updateCourse,
} from '../controllers/lessonController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { getAllSubmissions, getMySubmissions, getSubmissionByLesson, getSubmissionsByLesson, reviewSubmission, submitAssignment } from '../controllers/submissionController';

import { validate } from '../middleware/validate';
import * as AV from '../validators/admin.validators';
import * as LV from '../validators/learning.validators';
const router = Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.post('/create', isAuthenticated, isAuthorized('admin'), validate(AV.createCourseSchema), (_req, _res, next) => next());
router.patch('/:courseId', isAuthenticated, isAuthorized('admin'), validate(AV.courseIdParam, 'params'), validate(AV.updateCourseSchema), updateCourse);
router.get('/:courseId/curriculum', isAuthenticated, validate(AV.courseIdParam, 'params'), (_req, _res, next) => next());
router.get('/:courseId/modules', isAuthenticated, validate(AV.courseIdParam, 'params'), (_req, _res, next) => next());
router.post('/modules/create', isAuthenticated, isAuthorized('admin'), validate(AV.createModuleSchema), (_req, _res, next) => next());
router.patch('/modules/:moduleId', isAuthenticated, isAuthorized('admin'), validate(AV.moduleIdParam, 'params'), validate(AV.updateModuleSchema), (_req, _res, next) => next());
router.delete('/modules/:moduleId', isAuthenticated, isAuthorized('admin'), validate(AV.moduleIdParam, 'params'), (_req, _res, next) => next());
router.get('/modules/:moduleId/lessons', isAuthenticated, validate(AV.moduleIdParam, 'params'), (_req, _res, next) => next());
router.get('/lessons/:lessonId', isAuthenticated, validate(LV.lessonIdParam, 'params'), (_req, _res, next) => next());
router.post('/lessons/create', isAuthenticated, isAuthorized('admin'), validate(AV.createLessonSchema), (_req, _res, next) => next());
router.patch('/lessons/:lessonId', isAuthenticated, isAuthorized('admin'), validate(LV.lessonIdParam, 'params'), validate(AV.updateLessonSchema), (_req, _res, next) => next());
router.delete('/lessons/:lessonId', isAuthenticated, isAuthorized('admin'), validate(LV.lessonIdParam, 'params'), (_req, _res, next) => next());
router.get('/lessons/:lessonId/assignment', isAuthenticated, validate(LV.lessonIdParam, 'params'), (_req, _res, next) => next());
router.patch('/lessons/:lessonId/assignment', isAuthenticated, isAuthorized('admin'), validate(LV.lessonIdParam, 'params'), validate(AV.updateAssignmentSchema), (_req, _res, next) => next());
router.post('/lessons/:lessonId/submit', isAuthenticated, isAuthorized('kid'), validate(LV.lessonIdParam, 'params'), validate(LV.submitQuizSchema), (_req, _res, next) => next());
router.get('/lessons/:lessonId/questions', isAuthenticated, validate(LV.lessonIdParam, 'params'), (_req, _res, next) => next());
router.post('/lessons/:lessonId/questions', isAuthenticated, isAuthorized('admin'), validate(LV.lessonIdParam, 'params'), validate(AV.questionSchema), (_req, _res, next) => next());
router.patch('/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'), validate(AV.questionIdParam, 'params'), validate(AV.updateQuestionSchema), (_req, _res, next) => next());
router.delete('/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'), validate(AV.questionIdParam, 'params'), (_req, _res, next) => next());


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

// Assignment‑only routes
router.get(   '/lessons/:lessonId/assignment', isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getLessonAssignment);
router.patch('/lessons/:lessonId/assignment', isAuthenticated, isAuthorized('admin'),                   updateLessonAssignment);

// ✨ QUIZ SUBMISSION – students submit answers and get score
router.post('/lessons/:lessonId/submit', isAuthenticated, isAuthorized('parent', 'kid'), submitQuiz);

// ─── QUIZ QUESTIONS ───────────────────────────────────────────────────────────

router.get(   '/lessons/:lessonId/questions',   isAuthenticated, isAuthorized('parent', 'admin', 'kid'), getQuestions);
router.post(  '/lessons/:lessonId/questions',   isAuthenticated, isAuthorized('admin'),                  addQuestion);
router.patch( '/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'),                  updateQuestion);
router.delete('/lessons/questions/:questionId', isAuthenticated, isAuthorized('admin'),                  deleteQuestion);

export default router;