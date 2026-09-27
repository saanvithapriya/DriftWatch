import { Router } from "express";
import {
  getAuthCallback,
  getAuthStart,
  getLogout,
  getMe,
} from "./authController.js";

/**
 * Authentication routes, kept separate from repository routes.
 * POST /api/github/tree is untouched by this phase.
 */
const router = Router();

router.get("/auth/github", getAuthStart);
router.get("/auth/github/callback", getAuthCallback);
router.get("/auth/me", getMe);
router.get("/auth/logout", getLogout);

export default router;
