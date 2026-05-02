import { Router } from "express";
import {
  enrollKid,
  getMyEnrollments,
  getKidEnrollments,
  cancelEnrollment,
  getAllEnrollments,
  getEnrollmentById,
} from "../controllers/enrollmentController";
import { isAuthenticated, isAuthorized } from "../middleware/authMiddleware";

const router = Router();

router.use(isAuthenticated);

router.post("/create", isAuthorized("parent"), enrollKid);
router.get("/get", isAuthorized("parent"), getMyEnrollments);
router.get("/all", isAuthorized("admin"), getAllEnrollments);
router.get("/kid/:kidId", isAuthorized("admin"), getKidEnrollments);
router.get("/:enrollmentId", isAuthorized("parent"), getEnrollmentById); // ← new
router.patch("/:enrollmentId/cancel", isAuthorized("admin"), cancelEnrollment);

export default router;
