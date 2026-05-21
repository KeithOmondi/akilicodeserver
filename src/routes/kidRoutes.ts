import express from "express";
import * as kidController from "../controllers/kidController";
import * as kidLearningController from "../controllers/kidLearningController";
import { isAuthenticated, isAuthorized } from "../middleware/authMiddleware";

const router = express.Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────
router.post("/login", kidController.kidLogin);

// ─── PARENT PROTECTED (parent manages kids) ───────────────────────────────────
router.post("/register", isAuthenticated, isAuthorized("parent"), kidController.registerKid);
router.get("/my-kids", isAuthenticated, isAuthorized("parent"), kidController.getMyKids);
router.get("/:kidId", isAuthenticated, isAuthorized("parent"), kidController.getKidById);
router.patch("/:kidId", isAuthenticated, isAuthorized("parent"), kidController.updateKid);
router.post("/:kidId/set-login", isAuthenticated, isAuthorized("parent"), kidController.setKidLogin);
router.patch("/:kidId/update-login", isAuthenticated, isAuthorized("parent"), kidController.updateKidLogin);

// ─── KID PROTECTED (kid's own info) ───────────────────────────────────────────
router.get("/me", isAuthenticated, kidController.getKidMe);

// ─── KID LEARNING ROUTES (require kid role) ───────────────────────────────────
// Apply kid role middleware only for the routes below
router.use(isAuthenticated, isAuthorized("kid"));

router.get("/dashboard", kidLearningController.getDashboardStats);
router.get("/leaderboard", kidLearningController.getLeaderboard);
router.get("/achievements", kidLearningController.getAchievements);
router.get("/courses", kidLearningController.getMyCourses);
router.get("/courses/:enrollmentId/content", kidLearningController.getCourseContent);
router.get("/courses/:enrollmentId/lessons/:lessonId", kidLearningController.getLesson);
router.post("/courses/:enrollmentId/lessons/:lessonId/submit", kidLearningController.submitLesson);

export default router;