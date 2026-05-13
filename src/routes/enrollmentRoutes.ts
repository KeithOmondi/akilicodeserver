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

// Apply global authentication
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
router.get("/:enrollmentId", isAuthorized("parent", "kid"), getEnrollmentById);

/**
 * ADMIN ROUTES
 */
router.get("/all", isAuthorized("admin"), getAllEnrollments);
router.get("/kid/:kidId", isAuthorized("admin"), getKidEnrollments);
router.patch("/:enrollmentId/cancel", isAuthorized("admin"), cancelEnrollment);

export default router;