import express from 'express';
import {
  startFreeTrial,
  checkTrialStatus,
  getActiveTrials,
  convertTrialToEnrollment
} from '../controllers/trialController';
import { isAuthenticated } from '../middleware/authMiddleware';

import { validate } from '../middleware/validate';
import * as LV from '../validators/learning.validators';
const router = express.Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.post('/start', isAuthenticated, validate(LV.startTrialSchema), (_req, _res, next) => next());
router.get('/check/:kid_id/:course_id', isAuthenticated, validate(LV.trialParams, 'params'), (_req, _res, next) => next());
router.post('/convert/:trial_id', isAuthenticated, validate(LV.convertTrialParams, 'params'), validate(LV.convertTrialSchema), (_req, _res, next) => next());


// All trial routes require authentication
router.use(isAuthenticated);

router.post('/start', startFreeTrial);
router.get('/active', getActiveTrials);
router.get('/check/:kid_id/:course_id', checkTrialStatus);
router.post('/convert/:trial_id', convertTrialToEnrollment);

export default router;