import { Router } from 'express';
import {
  createPayment,
  getMyPayments,
  getKidPayments,
  getReceipt,
  getAllPayments,
} from '../controllers/paymentController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { manualPaymentSchema, paymentKidParam, paymentIdParam } from '../validators/admin.validators';

const router = Router();

// All payment routes require authentication
router.use(isAuthenticated);

// Admin-only route: Fetch every payment in the system
router.get('/all', isAuthorized('admin'), getAllPayments);

// Parent-specific routes
// Manual (cash / bank) entry: ADMIN ONLY. Parents can never mark themselves paid.
router.post('/create', isAuthorized('admin'), validate(manualPaymentSchema), createPayment);
router.get('/get', isAuthorized('parent'), getMyPayments);

// Admin-only route: Fetch payments for a specific child
router.get('/kid/:kidId', isAuthorized('admin'), validate(paymentKidParam, 'params'), getKidPayments);

// Shared route: Both parents (for their own) and admins can view receipts
router.get('/:paymentId/receipt', isAuthorized('parent', 'admin'), validate(paymentIdParam, 'params'), getReceipt);

export default router;
