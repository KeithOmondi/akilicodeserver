// pricing.interface.ts

export type BillingCycle = 'monthly' | 'termly' | 'once-off';

// ── Pricing Plans ─────────────────────────────────────────────────────────────

export interface IPricingPlan {
  id: string;
  name: string;
  billing_cycle: BillingCycle;
  price: number;
  original_price: number | null;  // for showing strikethrough
  duration_months: number;        // 1 = monthly, 3 = termly, 0 = once-off
  savings_percent: number | null; // e.g. 10, 15, 20
  badge: string | null;           // e.g. "Popular", "Best Value"
  features: string[];             // list of feature strings
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePricingPlanDTO {
  name: string;
  billing_cycle: BillingCycle;
  price: number;
  original_price?: number;
  duration_months: number;
  savings_percent?: number;
  badge?: string;
  features?: string[];
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdatePricingPlanDTO {
  name?: string;
  billing_cycle?: BillingCycle;
  price?: number;
  original_price?: number;
  duration_months?: number;
  savings_percent?: number;
  badge?: string;
  features?: string[];
  is_active?: boolean;
  sort_order?: number;
}

// ── Coupons ───────────────────────────────────────────────────────────────────

export type DiscountType = 'percentage' | 'fixed';

export interface ICoupon {
  id: string;
  code: string;                   // e.g. "AKILI10"
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;         // 10 = 10% or KES 10 depending on type
  applies_to: 'first_month' | 'all_months' | 'once';
  min_months: number | null;      // minimum plan duration to qualify
  max_uses: number | null;        // null = unlimited
  uses_count: number;
  valid_from: string;
  valid_until: string | null;     // null = no expiry
  is_active: boolean;
  created_at: string;
}

export interface CreateCouponDTO {
  code: string;
  description?: string;
  discount_type: DiscountType;
  discount_value: number;
  applies_to: 'first_month' | 'all_months' | 'once';
  min_months?: number;
  max_uses?: number;
  valid_from?: string;
  valid_until?: string;
  is_active?: boolean;
}

export interface UpdateCouponDTO {
  description?: string;
  discount_value?: number;
  applies_to?: 'first_month' | 'all_months' | 'once';
  min_months?: number;
  max_uses?: number;
  valid_until?: string;
  is_active?: boolean;
}

export interface ValidateCouponDTO {
  code: string;
  billing_cycle: BillingCycle;
  plan_id: string;
}

// ── Responses ────────────────────────────────────────────────────────────────

export interface CouponValidationResult {
  valid: boolean;
  coupon?: ICoupon;
  discount_amount?: number;       // KES amount off
  final_price?: number;           // price after discount
  message?: string;               // e.g. "10% off your first month!"
}

export interface PublicPricingPlan {
  id: string;
  name: string;
  billing_cycle: BillingCycle;
  price: number;
  original_price: number | null;
  duration_months: number;
  savings_percent: number | null;
  badge: string | null;
  features: string[];
}

export interface PricingPageData {
  plans: PublicPricingPlan[];
  trial_days: number;
  has_trial: boolean;
}