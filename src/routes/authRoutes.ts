import express from 'express';
import * as authController from '../controllers/authController';
import { isAuthenticated } from '../middleware/authMiddleware';

const router = express.Router();

// --- PUBLIC ROUTES ---
router.post('/register', authController.register);
router.get('/verify-email', authController.verifyEmail);
router.post('/login', authController.login);
router.get('/refresh', authController.refresh);

// --- PASSWORD RECOVERY ---
router.post('/forgot-password', authController.forgotPassword);
router.patch('/reset-password', authController.resetPassword);

// --- PROTECTED ROUTES ---
router.patch('/update-password', isAuthenticated, authController.updatePassword);
router.post('/logout', isAuthenticated, authController.logout);

export default router;