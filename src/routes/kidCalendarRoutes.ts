// src/routes/kidCalendarRoutes.ts
import { Router } from 'express';
import { getCalendarEvents } from '../controllers/kidCalendarController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// All calendar routes require kid authentication
router.use(isAuthenticated, isAuthorized('kid'));

router.get('/', getCalendarEvents);

export default router;