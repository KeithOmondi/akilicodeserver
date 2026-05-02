import { Router } from 'express';
import { 
  createPayment, 
  getMyPayments, 
  getKidPayments, 
  getReceipt,
  getAllPayments // Added this import
} from '../controllers/paymentController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// All payment routes require authentication
router.use(isAuthenticated);

// Admin-only route: Fetch every payment in the system
router.get('/all', isAuthorized("admin"), getAllPayments);

// Parent-specific routes
router.post('/create', isAuthorized("parent"), createPayment);
router.get('/get', isAuthorized("parent"), getMyPayments);

// Admin-only route: Fetch payments for a specific child
router.get('/kid/:kidId', isAuthorized("admin"), getKidPayments);

// Shared route: Both parents (for their own) and admins can view receipts
router.get('/:paymentId/receipt', isAuthorized("parent", "admin"), getReceipt);

export default router;