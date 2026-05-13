import express from 'express';
import {
  startFreeTrial,
  checkTrialStatus,
  getActiveTrials,
  convertTrialToEnrollment
} from '../controllers/trialController';
import { isAuthenticated } from '../middleware/authMiddleware';

const router = express.Router();

// All trial routes require authentication
router.use(isAuthenticated);

router.post('/start', startFreeTrial);
router.get('/active', getActiveTrials);
router.get('/check/:kid_id/:course_id', checkTrialStatus);
router.post('/convert/:trial_id', convertTrialToEnrollment);

export default router;