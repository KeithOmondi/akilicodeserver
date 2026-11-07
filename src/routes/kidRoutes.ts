import express from "express";
import * as kidController from "../controllers/kidController";
import * as kidAccount from "../controllers/kidAccountController";
import * as kidLearningController from "../controllers/kidLearningController";
import { getLeaderboard } from "../controllers/leaderboardController";
import { isAuthenticated, isParent, isKid } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { requireParentGate } from "../middleware/parentGate";
import { enforceScreenTime } from "../middleware/screenTime";
import { kidLoginLimiter, heartbeatLimiter, dataRequestLimiter } from "../middleware/rateLimiters";
import {
  kidLoginSchema, registerKidSchema, updateKidSchema, setKidLoginSchema, updateKidLoginSchema, kidIdParam,
  setPinSchema, pickerLoginSchema, leaderboardSchema, screenTimeSchema, heartbeatSchema, deleteKidSchema, consentForExistingKidSchema,
} from "../validators/kid.validators";
import { lessonParams, submitLessonSchema, limitQuery } from "../validators/learning.validators";

const router = express.Router();
const parent = [isAuthenticated, isParent];
const gated = [isAuthenticated, isParent, requireParentGate];
const kidId = validate(kidIdParam, "params");

// ─── PUBLIC / DEVICE ──────────────────────────────────────────────────────────
router.get("/consent-document", kidAccount.getConsentDocument);
router.post("/login", kidLoginLimiter, validate(kidLoginSchema), kidAccount.kidLogin);
router.get("/picker", kidLoginLimiter, kidAccount.picker);
router.post("/picker/login", kidLoginLimiter, validate(pickerLoginSchema), kidAccount.pickerLogin);

// ─── FAMILY DEVICE (parent) ───────────────────────────────────────────────────
router.post("/device/link", ...gated, kidAccount.linkDevice);
router.delete("/device/link", ...parent, kidAccount.unlinkDevice);

// ─── KID SESSION (cookie based, no token needed) ──────────────────────────────
router.get("/refresh", kidAccount.refreshKid);
router.post("/logout", kidAccount.logoutKid);

// ─── KID PROTECTED ────────────────────────────────────────────────────────────
// Fixed paths must come before /:kidId so they are not swallowed by the param route.
router.get("/me", isAuthenticated, isKid, kidController.getKidMe);
router.get("/me/screen-time", isAuthenticated, isKid, kidAccount.myScreenTime);
router.post("/me/heartbeat", isAuthenticated, isKid, heartbeatLimiter, validate(heartbeatSchema), kidAccount.heartbeat);
router.get("/dashboard", isAuthenticated, isKid, kidLearningController.getDashboardStats);
router.get("/leaderboard", isAuthenticated, isKid, getLeaderboard);
router.get("/achievements", isAuthenticated, isKid, kidLearningController.getAchievements);
router.get("/courses", isAuthenticated, isKid, kidLearningController.getMyCourses);
router.get("/courses/:enrollmentId/content", isAuthenticated, isKid, enforceScreenTime, kidLearningController.getCourseContent);
router.get("/courses/:enrollmentId/lessons/:lessonId", isAuthenticated, isKid, enforceScreenTime, validate(lessonParams, "params"), kidLearningController.getLesson);
router.post(
  "/courses/:enrollmentId/lessons/:lessonId/submit",
  isAuthenticated, isKid, enforceScreenTime, validate(lessonParams, "params"), validate(submitLessonSchema),
  kidLearningController.submitLesson
);

// ─── PARENT PROTECTED ─────────────────────────────────────────────────────────
router.post("/register", ...parent, validate(registerKidSchema), kidAccount.registerKid);
router.get("/my-kids", ...parent, kidAccount.listMyKids);
router.get("/:kidId", ...parent, kidId, kidController.getKidById);
router.patch("/:kidId", ...parent, kidId, validate(updateKidSchema), kidController.updateKid);
router.post("/:kidId/consent", ...parent, kidId, validate(consentForExistingKidSchema), kidAccount.recordConsentForExistingKid);

// Sensitive: need the parent gate (password / SMS code re-check).
router.put("/:kidId/pin", ...gated, kidId, validate(setPinSchema), kidAccount.setKidPin);
router.post("/:kidId/set-login", ...gated, kidId, validate(setKidLoginSchema), kidController.setKidLogin);
router.patch("/:kidId/update-login", ...gated, kidId, validate(updateKidLoginSchema), kidController.updateKidLogin);
router.put("/:kidId/leaderboard", ...gated, kidId, validate(leaderboardSchema), kidAccount.setLeaderboardOptIn);
router.get("/:kidId/screen-time", ...parent, kidId, kidAccount.getScreenTime);
router.put("/:kidId/screen-time", ...gated, kidId, validate(screenTimeSchema), kidAccount.setScreenTime);
router.get("/:kidId/export", ...gated, dataRequestLimiter, kidId, kidAccount.exportKid);
router.delete("/:kidId", ...gated, dataRequestLimiter, kidId, validate(deleteKidSchema), kidAccount.removeKid);

export default router;
