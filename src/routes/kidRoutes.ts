import express from "express";
import * as kidController from "../controllers/kidController";
import { isAuthenticated, isAuthorized } from "../middleware/authMiddleware";

const router = express.Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

// Kid logs in with username + PIN (no auth token needed)
router.post("/login", kidController.kidLogin);

// ─── PARENT PROTECTED ─────────────────────────────────────────────────────────

router.use(isAuthenticated);

router.post("/register", isAuthorized("parent"), kidController.registerKid);
router.get("/my-kids", isAuthorized("parent"), kidController.getMyKids);
router.get("/:kidId", isAuthorized("parent"), kidController.getKidById);
router.patch("/:kidId", isAuthorized("parent"), kidController.updateKid);

// ─── LOGIN MANAGEMENT (parent sets/updates kid credentials) ───────────────────

router.post("/:kidId/set-login", isAuthorized("parent"), kidController.setKidLogin);
router.patch("/:kidId/update-login", isAuthorized("parent"), kidController.updateKidLogin);

export default router;