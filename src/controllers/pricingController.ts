// pricingController.ts

import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import type {
  CreatePricingPlanDTO,
  UpdatePricingPlanDTO,
  CreateCouponDTO,
  UpdateCouponDTO,
  ValidateCouponDTO,
  CouponValidationResult,
} from '../interfaces/pricing.interface';

interface AuthRequest extends Request {
  user?: IUser;
}

// ── PUBLIC ────────────────────────────────────────────────────────────────────

/**
 * GET /pricing/plans — public
 * Returns active plans ordered by sort_order
 */
export const getPublicPlans = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT id, name, billing_cycle, price, original_price,
              duration_months, savings_percent, badge, features
       FROM pricing_plans
       WHERE is_active = true
       ORDER BY sort_order ASC`
    );

    // Also fetch trial info from courses (use global default)
    const trialResult = await pool.query(
      `SELECT trial_duration_days, is_trial_available
       FROM courses
       WHERE is_trial_available = true
       LIMIT 1`
    );

    const trial = trialResult.rows[0];

    res.status(200).json({
      status: 'success',
      data: {
        plans:      result.rows,
        trial_days: trial?.trial_duration_days ?? 5,
        has_trial:  !!trial,
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /pricing/validate-coupon — public (parent must be logged in)
 * Validates a coupon code against a plan
 */
export const validateCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, billing_cycle, plan_id }: ValidateCouponDTO = req.body;

    if (!code || !billing_cycle || !plan_id) {
      return next(new AppError('Please provide code, billing_cycle, and plan_id.', 400));
    }

    // Fetch coupon
    const couponResult = await pool.query(
      `SELECT * FROM coupons
       WHERE UPPER(code) = UPPER($1)
         AND is_active = true
         AND (valid_until IS NULL OR valid_until > NOW())
         AND (max_uses IS NULL OR uses_count < max_uses)`,
      [code]
    );

    if (couponResult.rows.length === 0) {
      const result: CouponValidationResult = {
        valid:   false,
        message: 'Invalid or expired coupon code.',
      };
      return res.status(200).json({ status: 'success', data: result });
    }

    const coupon = couponResult.rows[0];

    // Fetch plan to calculate discount
    const planResult = await pool.query(
      `SELECT * FROM pricing_plans WHERE id = $1 AND is_active = true`,
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      return next(new AppError('Plan not found.', 404));
    }

    const plan = planResult.rows[0];

    // Check min_months requirement
    if (coupon.min_months && plan.duration_months < coupon.min_months) {
      const result: CouponValidationResult = {
        valid:   false,
        message: `This coupon requires a minimum ${coupon.min_months}-month plan.`,
      };
      return res.status(200).json({ status: 'success', data: result });
    }

    // Calculate discount amount
    let discountAmount = 0;
    const monthlyEquivalent = plan.price / (plan.duration_months || 1);

    if (coupon.discount_type === 'percentage') {
      if (coupon.applies_to === 'first_month') {
        // e.g. 10% off first month's equivalent
        discountAmount = Math.round((monthlyEquivalent * coupon.discount_value) / 100);
      } else {
        // percentage off total
        discountAmount = Math.round((plan.price * coupon.discount_value) / 100);
      }
    } else {
      // fixed amount off
      discountAmount = coupon.discount_value;
    }

    const finalPrice = Math.max(0, plan.price - discountAmount);

    const appliesMsg =
      coupon.applies_to === 'first_month' ? 'your first month' :
      coupon.applies_to === 'all_months'  ? 'all months'       : 'this plan';

    const result: CouponValidationResult = {
      valid:           true,
      coupon,
      discount_amount: discountAmount,
      final_price:     finalPrice,
      message:         `${coupon.discount_type === 'percentage'
        ? `${coupon.discount_value}% off`
        : `KES ${coupon.discount_value} off`} ${appliesMsg}! You save KES ${discountAmount.toLocaleString()}.`,
    };

    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
};

// ── ADMIN — PLANS ─────────────────────────────────────────────────────────────

/**
 * GET /pricing/admin/plans
 */
export const getAllPlans = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT * FROM pricing_plans ORDER BY sort_order ASC`
    );
    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { plans: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /pricing/admin/plans
 */
export const createPlan = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, billing_cycle, price, original_price,
      duration_months, savings_percent, badge, features,
      is_active, sort_order,
    }: CreatePricingPlanDTO = req.body;

    if (!name || !billing_cycle || !price || duration_months === undefined) {
      return next(new AppError('name, billing_cycle, price and duration_months are required.', 400));
    }

    const result = await pool.query(
      `INSERT INTO pricing_plans
        (name, billing_cycle, price, original_price, duration_months,
         savings_percent, badge, features, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        name, billing_cycle, price, original_price ?? null,
        duration_months, savings_percent ?? null, badge ?? null,
        features ?? [], is_active ?? true, sort_order ?? 0,
      ]
    );

    res.status(201).json({
      status: 'success',
      data: { plan: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /pricing/admin/plans/:planId
 */
export const updatePlan = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.params;
    const updates: UpdatePricingPlanDTO = req.body;

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return next(new AppError('No fields to update.', 400));
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values     = fields.map((f) => (updates as Record<string, unknown>)[f]);

    const result = await pool.query(
      `UPDATE pricing_plans
       SET ${setClauses}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [planId, ...values]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Plan not found.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { plan: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /pricing/admin/plans/:planId
 */
export const deletePlan = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.params;

    const result = await pool.query(
      `DELETE FROM pricing_plans WHERE id = $1 RETURNING id`,
      [planId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Plan not found.', 404));
    }

    res.status(200).json({
      status: 'success',
      message: 'Plan deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// ── ADMIN — COUPONS ───────────────────────────────────────────────────────────

/**
 * GET /pricing/admin/coupons
 */
export const getAllCoupons = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT * FROM coupons ORDER BY created_at DESC`
    );
    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { coupons: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /pricing/admin/coupons
 */
export const createCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      code, description, discount_type, discount_value,
      applies_to, min_months, max_uses, valid_from, valid_until, is_active,
    }: CreateCouponDTO = req.body;

    if (!code || !discount_type || !discount_value) {
      return next(new AppError('code, discount_type, and discount_value are required.', 400));
    }

    const result = await pool.query(
      `INSERT INTO coupons
        (code, description, discount_type, discount_value, applies_to,
         min_months, max_uses, valid_from, valid_until, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        code.toUpperCase(), description ?? null, discount_type, discount_value,
        applies_to ?? 'first_month', min_months ?? null, max_uses ?? null,
        valid_from ?? new Date(), valid_until ?? null, is_active ?? true,
      ]
    );

    res.status(201).json({
      status: 'success',
      data: { coupon: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /pricing/admin/coupons/:couponId
 */
export const updateCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { couponId } = req.params;
    const updates: UpdateCouponDTO = req.body;

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return next(new AppError('No fields to update.', 400));
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values     = fields.map((f) => (updates as Record<string, unknown>)[f]);

    const result = await pool.query(
      `UPDATE coupons
       SET ${setClauses}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [couponId, ...values]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Coupon not found.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { coupon: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /pricing/admin/coupons/:couponId
 */
export const deleteCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { couponId } = req.params;

    const result = await pool.query(
      `DELETE FROM coupons WHERE id = $1 RETURNING id`,
      [couponId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Coupon not found.', 404));
    }

    res.status(200).json({ status: 'success', message: 'Coupon deleted.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /pricing/admin/coupons/:couponId/toggle
 * Quickly enable/disable a coupon
 */
export const toggleCoupon = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { couponId } = req.params;

    const result = await pool.query(
      `UPDATE coupons
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [couponId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Coupon not found.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { coupon: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};