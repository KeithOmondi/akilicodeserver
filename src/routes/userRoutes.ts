// routes/userRoutes.ts
import { Router } from 'express';
import {
  registerParent,
  loginParent,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  getParentProfile,
  updateParentProfile,
  changePassword,
  requestAccountDeletion,
  enableTwoFactor,
  disableTwoFactor,
  loginKid,
  logoutKid,
  createKidAccount,
  getParentKids,
  getKidById,
  updateKidProfile,
  deleteKidAccount,
  updateKidPin,
  unlockKidPin,
  updateKidSessionTimeout,
  revokeConsent,
  updateGranularConsent,
  getKidActivity,
  getAllUsers,
  getUserById,
  updateUserRole,
  adminDeleteUser,
} from '../controllers/userController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = Router();

// ─── PUBLIC AUTH ──────────────────────────────────────────────────────────────

router.post('/auth/register', registerParent);
router.post('/auth/login', loginParent);
router.get('/auth/verify-email/:token', verifyEmail);
router.post('/auth/resend-verification', resendVerification);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/reset-password/:token', resetPassword);

// ─── KID AUTH ─────────────────────────────────────────────────────────────────

router.post('/auth/kid/login', loginKid);
router.post('/auth/kid/logout', isAuthenticated, isAuthorized('kid'), logoutKid);

// ─── PARENT PROFILE ───────────────────────────────────────────────────────────

router.get('/parent/profile', isAuthenticated, isAuthorized('parent'), getParentProfile);
router.patch('/parent/profile', isAuthenticated, isAuthorized('parent'), updateParentProfile);
router.patch('/parent/change-password', isAuthenticated, isAuthorized('parent'), changePassword);
router.delete('/parent/account', isAuthenticated, isAuthorized('parent'), requestAccountDeletion);

// ─── TWO-FACTOR AUTH ──────────────────────────────────────────────────────────

router.post('/parent/2fa/enable', isAuthenticated, isAuthorized('parent'), enableTwoFactor);
router.post('/parent/2fa/disable', isAuthenticated, isAuthorized('parent'), disableTwoFactor);

// ─── KID MANAGEMENT ───────────────────────────────────────────────────────────

router.post('/parent/kids', isAuthenticated, isAuthorized('parent'), createKidAccount);
router.get('/parent/kids', isAuthenticated, isAuthorized('parent'), getParentKids);
router.get('/parent/kids/:kidId', isAuthenticated, isAuthorized('parent'), getKidById);
router.patch('/parent/kids/:kidId', isAuthenticated, isAuthorized('parent'), updateKidProfile);
router.delete('/parent/kids/:kidId', isAuthenticated, isAuthorized('parent'), deleteKidAccount);

// ─── KID PIN & SESSION ────────────────────────────────────────────────────────

router.patch('/parent/kids/:kidId/pin', isAuthenticated, isAuthorized('parent'), updateKidPin);
router.post('/parent/kids/:kidId/pin/unlock', isAuthenticated, isAuthorized('parent'), unlockKidPin);
router.patch('/parent/kids/:kidId/session', isAuthenticated, isAuthorized('parent'), updateKidSessionTimeout);

// ─── CONSENT ──────────────────────────────────────────────────────────────────

router.delete('/parent/kids/:kidId/consent', isAuthenticated, isAuthorized('parent'), revokeConsent);
router.patch('/parent/kids/:kidId/consent', isAuthenticated, isAuthorized('parent'), updateGranularConsent);

// ─── KID ACTIVITY ─────────────────────────────────────────────────────────────

router.get('/parent/kids/:kidId/activity', isAuthenticated, isAuthorized('parent'), getKidActivity);

// ─── ADMIN ────────────────────────────────────────────────────────────────────

router.get('/admin/users', isAuthenticated, isAuthorized('admin'), getAllUsers);
router.get('/admin/users/:userId', isAuthenticated, isAuthorized('admin'), getUserById);
router.patch('/admin/users/:userId/role', isAuthenticated, isAuthorized('admin'), updateUserRole);
router.delete('/admin/users/:userId', isAuthenticated, isAuthorized('admin'), adminDeleteUser);

export default router;