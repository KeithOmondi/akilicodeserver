import { Router } from 'express';
import { initializePaystack, paystackEnabled, paystackWebhook, verifyPaystack } from '../controllers/paystackController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { requireParentGate } from '../middleware/parentGate';
import { paymentLimiter, paymentStatusLimiter, mpesaWebhookLimiter } from '../middleware/rateLimiters';
import { paystackInitSchema, paystackReferenceParam } from '../validators/paystack.validators';

const router = Router();

// ── Parent ───────────────────────────────────────────────────────────────────
router.get('/enabled', isAuthenticated, isAuthorized('parent'), paystackEnabled);
router.post('/initialize', isAuthenticated, isAuthorized('parent'), requireParentGate, paymentLimiter, validate(paystackInitSchema), initializePaystack);
router.get('/verify/:reference', isAuthenticated, isAuthorized('parent'), paymentStatusLimiter, validate(paystackReferenceParam, 'params'), verifyPaystack);

// ── Paystack -> us. Proven by the signature header, not by a secret in the URL. ──
router.post('/webhook', mpesaWebhookLimiter, paystackWebhook);

export default router;
