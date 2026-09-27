import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";
import { SESSION_TTL_MS } from "./sessionService.js";

export const SESSION_COOKIE_NAME = "driftwatch_session";

/**
 * The cookie carries nothing but an opaque session id — no user data, no
 * credential. HttpOnly keeps it away from page JavaScript, so an XSS bug
 * cannot read it; SameSite=Lax still allows the top-level GET redirect back
 * from GitHub to arrive with the cookie attached.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.sessionCookieSecure,
    path: "/",
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    ...baseOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions());
}
