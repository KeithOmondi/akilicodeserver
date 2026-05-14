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

const router = Router();

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