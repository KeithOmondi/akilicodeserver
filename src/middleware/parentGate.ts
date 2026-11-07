import { Request, Response, NextFunction } from 'express';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { verifyGateToken } from '../services/tokens';

/**
 * Step-up check for sensitive actions (payments, deleting data, changing a
 * child's PIN or screen time). The browser first calls POST /auth/parent-gate
 * with the parent's password or an SMS code and receives a 10-minute token,
 * then sends it in the `X-Parent-Gate` header.
 *
 * This protects a parent who stays logged in on a device their child uses.
 * Turn off with PARENT_GATE_REQUIRED=false (e.g. while the app is being updated).
 */
export const requireParentGate = (req: Request, _res: Response, next: NextFunction) => {
  if (!env.PARENT_GATE_REQUIRED) return next();
  const userId = (req.user as { id?: string } | undefined)?.id;
  const token = req.header('x-parent-gate');
  if (!userId || !token || !verifyGateToken(token, userId)) {
    const err = new AppError('Please confirm it is you before continuing.', 403);
    (err as AppError & { code?: string }).code = 'PARENT_GATE_REQUIRED';
    return next(err);
  }
  next();
};
