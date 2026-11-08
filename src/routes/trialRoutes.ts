import express from 'express';
import { startFreeTrial, checkTrialStatus, getActiveTrials, getTrialEligibility } from '../controllers/trialController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import * as LV from '../validators/learning.validators';

const router = express.Router();

// All trial routes are for a signed-in parent.
router.use(isAuthenticated, isAuthorized('parent'));

router.get('/eligibility', getTrialEligibility);
router.post('/start', validate(LV.startTrialSchema), startFreeTrial);
router.get('/active', getActiveTrials);
router.get('/check/:kid_id/:course_id', validate(LV.trialParams, 'params'), checkTrialStatus);

export default router;
