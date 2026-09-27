import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../utils/appError.js";
import type { SessionStore } from "./sessionService.js";
import { SESSION_COOKIE_NAME, clearSessionCookie } from "./sessionCookie.js";

/**
 * Loads the session for requests that carry a valid cookie, and does nothing
 * otherwise. Authentication is never forced globally: anonymous access to
 * public repositories has to keep working.
 */
export function createAttachSession(sessions: SessionStore): RequestHandler {
  return function attachSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const sessionId = cookies?.[SESSION_COOKIE_NAME];

    if (typeof sessionId !== "string" || sessionId === "") {
      next();
      return;
    }

    const session = sessions.get(sessionId);
    if (session === null) {
      // Expired or unknown: drop the stale cookie so the browser stops
      // presenting it.
      clearSessionCookie(res);
      next();
      return;
    }

    req.driftwatchSession = session;
    next();
  };
}

/** Rejects a request that has no session. Used only on routes that need one. */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.driftwatchSession === undefined) {
    next(new AppError(401, "Authentication required"));
    return;
  }
  next();
}
