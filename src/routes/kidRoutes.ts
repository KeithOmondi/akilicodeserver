import express from "express";
import * as kidController from "../controllers/kidController";
import { isAuthenticated, isAuthorized } from "../middleware/authMiddleware";

const router = express.Router();

// Protect all routes below this middleware
router.use(isAuthenticated);

router.post("/register", isAuthorized("parent"), kidController.registerKid);
router.get("/my-kids", isAuthorized("parent"), kidController.getMyKids);

export default router;
