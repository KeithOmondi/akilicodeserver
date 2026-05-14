// pricingRoutes.ts

import { Router } from 'express';
import {
  getPublicPlans, validateCoupon,
  getAllPlans, createPlan, updatePlan, deletePlan,
  getAllCoupons, createCoupon, updateCoupon, deleteCoupon, toggleCoupon,
} from '../controllers/pricingController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/plans',              getPublicPlans);
router.post('/validate-coupon',   isAuthenticated, validateCoupon);

// ── Admin — Plans ─────────────────────────────────────────────────────────────
router.get('/admin/plans',              isAuthenticated, isAuthorized("admin"), getAllPlans);
router.post('/admin/plans',             isAuthenticated, isAuthorized("admin"), createPlan);
router.put('/admin/plans/:planId',      isAuthenticated, isAuthorized("admin"), updatePlan);
router.delete('/admin/plans/:planId',   isAuthenticated, isAuthorized("admin"), deletePlan);

// ── Admin — Coupons ───────────────────────────────────────────────────────────
router.get('/admin/coupons',                    isAuthenticated, isAuthorized("admin"), getAllCoupons);
router.post('/admin/coupons',                   isAuthenticated, isAuthorized("admin"), createCoupon);
router.put('/admin/coupons/:couponId',          isAuthenticated, isAuthorized("admin"), updateCoupon);
router.delete('/admin/coupons/:couponId',       isAuthenticated, isAuthorized("admin"), deleteCoupon);
router.post('/admin/coupons/:couponId/toggle',  isAuthenticated, isAuthorized("admin"), toggleCoupon);

export default router;