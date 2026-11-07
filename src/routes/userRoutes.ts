import { Router } from 'express';
import { getAllUsers, getUserById, adminDeleteUser, updateUserRole } from '../controllers/accountController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { userIdParam, updateRoleSchema } from '../validators/admin.validators';

/**
 * Mounted at /api/v1/admin/users — ADMIN ONLY.
 *
 * This file used to also expose a second, unfinished copy of registration, login,
 * password reset, child login and consent (e.g. POST /api/v1/admin/users/auth/register).
 * Those routes were public, unrated, and written for database columns that do not
 * exist, so they have been removed. The real ones live under /api/v1/auth and /api/v1/kids.
 * (The admin routes were also mounted one level too deep, so the admin Users page got a 404.)
 */
const router = Router();
const admin = [isAuthenticated, isAuthorized('admin')];

router.get('/', ...admin, getAllUsers);
router.get('/:userId', ...admin, validate(userIdParam, 'params'), getUserById);
router.patch('/:userId/role', ...admin, validate(userIdParam, 'params'), validate(updateRoleSchema), updateUserRole);
router.delete('/:userId', ...admin, validate(userIdParam, 'params'), adminDeleteUser);

export default router;
