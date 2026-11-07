import express from 'express';
import * as authController from '../controllers/authController';
import * as phoneAuth from '../controllers/phoneAuthController';
import * as account from '../controllers/accountController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { requireParentGate } from '../middleware/parentGate';
import { validate } from '../middleware/validate';
import {
  loginLimiter,
  loginIpLimiter,
  registerLimiter,
  passwordResetLimiter,
  otpLimiter,
  otpSendIpLimiter,
  otpVerifyLimiter,
  gateLimiter,
  dataRequestLimiter,
} from '../middleware/rateLimiters';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updatePasswordSchema,
  verifyEmailQuery,
  otpRequestSchema,
  otpVerifySchema,
  parentGateSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from '../validators/auth.validators';

const router = express.Router();
const parent = [isAuthenticated, isAuthorized('parent')];

// --- PUBLIC ROUTES (email + password) ---
router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.get('/verify-email', otpLimiter, validate(verifyEmailQuery, 'query'), authController.verifyEmail);
router.post('/login', loginIpLimiter, loginLimiter, validate(loginSchema), authController.login);
router.get('/refresh', authController.refresh);

// --- PUBLIC ROUTES (phone + SMS code) ---
// Sends cost money: per-IP limit here, per-phone / site-wide limits in services/otpService.ts
router.post('/otp/request', otpSendIpLimiter, validate(otpRequestSchema), phoneAuth.otpRequest);
router.post('/otp/verify', otpVerifyLimiter, validate(otpVerifySchema), phoneAuth.otpVerify);

// --- PASSWORD RECOVERY ---
router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.patch('/reset-password', passwordResetLimiter, otpLimiter, validate(resetPasswordSchema), authController.resetPassword);

// --- PROTECTED ROUTES ---
router.patch('/update-password', isAuthenticated, validate(updatePasswordSchema), authController.updatePassword);
router.post('/logout', isAuthenticated, authController.logout);

// --- PARENT GATE: re-check password / SMS code, get a 10-minute token for sensitive actions ---
router.post('/parent-gate/otp', ...parent, otpSendIpLimiter, phoneAuth.gateOtpRequest);
router.post('/parent-gate', ...parent, gateLimiter, validate(parentGateSchema), phoneAuth.parentGate);

// --- YOUR DATA ---
router.get('/me/export', ...parent, requireParentGate, dataRequestLimiter, account.exportMe);
router.patch('/me', ...parent, validate(updateProfileSchema), account.updateMe);
router.delete('/me', ...parent, requireParentGate, dataRequestLimiter, validate(deleteAccountSchema), account.deleteMe);

export default router;
