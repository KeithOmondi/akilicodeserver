// src/routes/kidCalendarRoutes.ts
import { Router } from 'express';
import { getCalendarEvents } from '../controllers/kidCalendarController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

import { validate } from '../middleware/validate';
import * as LV from '../validators/learning.validators';
const router = Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.get('/', isAuthenticated, isAuthorized('kid'), validate(LV.calendarQuery, 'query'), (_req, _res, next) => next());


// All calendar routes require kid authentication
router.use(isAuthenticated, isAuthorized('kid'));

router.get('/', getCalendarEvents);

export default router;