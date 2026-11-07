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

import { validate } from '../middleware/validate';
import * as AV from '../validators/admin.validators';
import * as LV from '../validators/learning.validators';
const router = express.Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.get('/', validate(AV.testimonialsQuery, 'query'), (_req, _res, next) => next());
router.post('/', isAuthenticated, validate(AV.createTestimonialSchema), (_req, _res, next) => next());
router.patch('/:testimonialId', isAuthenticated, validate(AV.testimonialIdParam, 'params'), validate(AV.updateTestimonialSchema), (_req, _res, next) => next());
router.get('/admin/all', isAuthenticated, isAuthorized('admin'), validate(AV.testimonialsQuery, 'query'), (_req, _res, next) => next());
router.patch('/admin/:testimonialId/approve', isAuthenticated, isAuthorized('admin'), validate(AV.testimonialIdParam, 'params'), validate(AV.adminNoteSchema), (_req, _res, next) => next());
router.patch('/admin/:testimonialId/reject', isAuthenticated, isAuthorized('admin'), validate(AV.testimonialIdParam, 'params'), validate(AV.adminNoteSchema), (_req, _res, next) => next());
router.patch('/admin/:testimonialId/feature', isAuthenticated, isAuthorized('admin'), validate(AV.testimonialIdParam, 'params'), (_req, _res, next) => next());
router.delete('/admin/:testimonialId', isAuthenticated, isAuthorized('admin'), validate(AV.testimonialIdParam, 'params'), (_req, _res, next) => next());


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