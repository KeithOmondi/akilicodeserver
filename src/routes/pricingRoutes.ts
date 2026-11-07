// pricingRoutes.ts

import { Router } from 'express';
import {
  getPublicPlans, validateCoupon,
  getAllPlans, createPlan, updatePlan, deletePlan,
  getAllCoupons, createCoupon, updateCoupon, deleteCoupon, toggleCoupon,
} from '../controllers/pricingController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  createPlanSchema, updatePlanSchema, planIdParam,
  createCouponSchema, updateCouponSchema, couponIdParam, validateCouponSchema,
} from '../validators/admin.validators';

const router = Router();
const admin = [isAuthenticated, isAuthorized('admin')];

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/plans',              getPublicPlans);
router.post('/validate-coupon',   isAuthenticated, validate(validateCouponSchema), validateCoupon);

// ── Admin — Plans ─────────────────────────────────────────────────────────────
// The schemas are strict whitelists: update handlers build SQL from the body's keys,
// so only the columns named in the schema can ever reach the query.
router.get('/admin/plans',              ...admin, getAllPlans);
router.post('/admin/plans',             ...admin, validate(createPlanSchema), createPlan);
router.put('/admin/plans/:planId',      ...admin, validate(planIdParam, 'params'), validate(updatePlanSchema), updatePlan);
router.delete('/admin/plans/:planId',   ...admin, validate(planIdParam, 'params'), deletePlan);

// ── Admin — Coupons ───────────────────────────────────────────────────────────
router.get('/admin/coupons',                    ...admin, getAllCoupons);
router.post('/admin/coupons',                   ...admin, validate(createCouponSchema), createCoupon);
router.put('/admin/coupons/:couponId',          ...admin, validate(couponIdParam, 'params'), validate(updateCouponSchema), updateCoupon);
router.delete('/admin/coupons/:couponId',       ...admin, validate(couponIdParam, 'params'), deleteCoupon);
router.post('/admin/coupons/:couponId/toggle',  ...admin, validate(couponIdParam, 'params'), toggleCoupon);

export default router;
