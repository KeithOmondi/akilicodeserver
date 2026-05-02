import { Router } from 'express';
import { createCourse, getAllCourses } from '../controllers/courseController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// Public or Parent view (Authenticated)
router.get('/', isAuthenticated, isAuthorized("parent", "admin"), getAllCourses);

// Admin only: Create and Manage
router.post('/create', isAuthenticated, isAuthorized("admin"), createCourse);

export default router;