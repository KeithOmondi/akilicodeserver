import { Router } from 'express';
import {
  stkPush,
  stkCallback,
  c2bValidation,
  c2bConfirmation,
  registerUrls,
  checkPaymentStatus,
  mpesaWebhookGuard,
  listReviewPayments,
  approveReviewPayment,
} from '../controllers/mpesaController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { requireParentGate } from '../middleware/parentGate';
import { paymentLimiter, paymentStatusLimiter, mpesaWebhookLimiter } from '../middleware/rateLimiters';
import { stkPushSchema, enrollmentIdParam, paymentIdParam } from '../validators/mpesa.validators';

const router = Router();

// ── Parent ───────────────────────────────────────────────────────────────────
router.post('/stk-push', isAuthenticated, isAuthorized('parent'), requireParentGate, paymentLimiter, validate(stkPushSchema), stkPush);
router.get(
  '/status/:enrollmentId',
  isAuthenticated,
  isAuthorized('parent'),
  paymentStatusLimiter,
  validate(enrollmentIdParam, 'params'),
  checkPaymentStatus
);

// ── Safaricom -> us. The last path segment is a long secret (MPESA_CALLBACK_SECRET). ──
router.post('/callback/:secret', mpesaWebhookLimiter, mpesaWebhookGuard('stk_callback'), stkCallback);
router.post('/c2b/validate/:secret', mpesaWebhookLimiter, mpesaWebhookGuard('c2b_validate'), c2bValidation);
router.post('/c2b/confirm/:secret', mpesaWebhookLimiter, mpesaWebhookGuard('c2b_confirm'), c2bConfirmation);

// ── Admin ────────────────────────────────────────────────────────────────────
router.post('/register-urls', isAuthenticated, isAuthorized('admin'), registerUrls);
router.get('/review', isAuthenticated, isAuthorized('admin'), listReviewPayments);
router.post('/review/:paymentId/approve', isAuthenticated, isAuthorized('admin'), validate(paymentIdParam, 'params'), approveReviewPayment(true));
router.post('/review/:paymentId/reject', isAuthenticated, isAuthorized('admin'), validate(paymentIdParam, 'params'), approveReviewPayment(false));

export default router;
