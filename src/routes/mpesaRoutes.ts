import { Router } from 'express';
import {
  stkPush,
  stkCallback,
  c2bValidation,
  c2bConfirmation,
  registerUrls,
  checkPaymentStatus,
} from '../controllers/mpesaController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// Protected — parent initiates STK push from the app
router.post('/stk-push', isAuthenticated, isAuthorized("parent"), stkPush);

// Protected — frontend polls this instead of waiting for callback
router.get('/status/:enrollmentId', isAuthenticated, isAuthorized("parent"), checkPaymentStatus);

// Public — Safaricom calls these directly (kept as backup)
router.post('/callback', stkCallback);
router.post('/c2b/validate', c2bValidation);
router.post('/c2b/confirm', c2bConfirmation);

// Protected — admin registers C2B URLs once
router.post('/register-urls', isAuthenticated, registerUrls);

export default router;