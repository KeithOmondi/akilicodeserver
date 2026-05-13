import express from 'express';
import {
  getApprovedTestimonials,
  getTestimonialStats,
  canLeaveTestimonial,
  createTestimonial,
  getMyTestimonials,
  updateTestimonial,
  getAllTestimonials,
  approveTestimonial,
  rejectTestimonial,
  toggleFeatured,
  deleteTestimonial
} from '../controllers/testimonialController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = express.Router();

// Public routes
router.get('/', getApprovedTestimonials);
router.get('/stats', getTestimonialStats);

// Protected routes (parent)
router.use(isAuthenticated);
router.get('/check/:kidId', canLeaveTestimonial);
router.post('/', createTestimonial);
router.get('/my', getMyTestimonials);
router.patch('/:testimonialId', updateTestimonial);

// Admin only routes
router.use(isAuthorized('admin'));
router.get('/admin/all', getAllTestimonials);
router.patch('/admin/:testimonialId/approve', approveTestimonial);
router.patch('/admin/:testimonialId/reject', rejectTestimonial);
router.patch('/admin/:testimonialId/feature', toggleFeatured);
router.delete('/admin/:testimonialId', deleteTestimonial);

export default router;