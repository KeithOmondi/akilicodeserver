import { Router } from "express";
import {
  enrollKid,
  getMyEnrollments,
  getKidEnrollments,
  cancelEnrollment,
  getAllEnrollments,
  getEnrollmentById,
  getMyEnrolledCourses,
} from "../controllers/enrollmentController";
import { isAuthenticated, isAuthorized } from "../middleware/authMiddleware";

import { validate } from '../middleware/validate';
import * as AV from '../validators/admin.validators';
import * as LV from '../validators/learning.validators';
const router = Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.post('/create', isAuthenticated, isAuthorized('parent'), validate(LV.enrollKidSchema), (_req, _res, next) => next());
router.get('/kid/:kidId', isAuthenticated, isAuthorized('admin'), validate(AV.enrollmentKidParam, 'params'), (_req, _res, next) => next());
router.patch('/:enrollmentId/cancel', isAuthenticated, validate(LV.enrollmentParam, 'params'), (_req, _res, next) => next());


router.use(isAuthenticated);

/**
 * KID ROUTES
 */
router.get("/my-courses", isAuthorized("kid"), getMyEnrolledCourses);

/**
 * PARENT ROUTES
 */
router.post("/create", isAuthorized("parent"), enrollKid);
router.get("/get", isAuthorized("parent"), getMyEnrollments);

/**
 * ADMIN ROUTES — must be before /:enrollmentId
 */
router.get("/all", isAuthorized("admin"), getAllEnrollments);
router.get("/kid/:kidId", isAuthorized("admin"), getKidEnrollments);

/**
 * PARAM ROUTES — always last
 */
router.get("/:enrollmentId", isAuthorized("parent", "kid"), getEnrollmentById);
router.patch("/:enrollmentId/cancel", isAuthorized("admin", "parent"), cancelEnrollment);

export default router;