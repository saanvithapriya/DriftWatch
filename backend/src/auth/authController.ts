import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { getAuthService, sessionStore } from "./authRuntime.js";
import { inspectGithubAppConfig } from "./githubApp.js";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  setSessionCookie,
} from "./sessionCookie.js";

/**
 * Redirect targets are always built from the configured frontend origin. The
 * browser never supplies a redirect, so there is no open-redirect surface.
 */
function frontendUrl(status: "connected" | "error"): string {
  const url = new URL(env.frontendUrl);
  url.searchParams.set("auth", status);
  return url.toString();
}

export function getAuthStart(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = getAuthService();
  if (auth === null) {
    const config = inspectGithubAppConfig();

    if (config.status === "partial") {
      // The operator has set up half of it — almost always a typo or an
      // unfinished .env. The missing variable *names* go to the server log
      // (they are not secrets, but they are nobody else's business); the
      // client gets a message that distinguishes this from "not set up".
      console.error(
        `GitHub sign-in is misconfigured: missing ${config.missing.join(", ")}. ` +
          "See the GitHub Authentication section of the README."
      );
      next(
        new AppError(
          503,
          "GitHub sign-in is misconfigured on this server. Check the server logs."
        )
      );
      return;
    }

    next(
      new AppError(503, "GitHub sign-in is not configured on this server.")
    );
    return;
  }

  const { url } = auth.beginAuthorization();
  res.redirect(url);
}

export async function getAuthCallback(
  req: Request,
  res: Response
): Promise<void> {
  const auth = getAuthService();
  if (auth === null) {
    res.redirect(frontendUrl("error"));
    return;
  }

  try {
    const session = await auth.completeAuthorization(
      req.query.code,
      req.query.state
    );
    setSessionCookie(res, session.id);
    res.redirect(frontendUrl("connected"));
  } catch {
    // This is a browser navigation, so failures return the user to the app
    // rather than rendering a JSON error page. Nothing about the failure is
    // echoed back, since the inputs came from a redirect we did not control.
    clearSessionCookie(res);
    res.redirect(frontendUrl("error"));
  }
}

/**
 * Safe profile only. The GitHub credential is deliberately not part of this
 * response and must never be added to it.
 */
export function getMe(req: Request, res: Response): void {
  const session = req.driftwatchSession;

  if (session === undefined) {
    res.status(200).json({ success: true, data: { user: null } });
    return;
  }

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: session.user.id,
        login: session.user.login,
        name: session.user.name,
        avatarUrl: session.user.avatarUrl,
      },
    },
  });
}

export async function getLogout(req: Request, res: Response): Promise<void> {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  const auth = getAuthService();

  if (typeof sessionId === "string" && sessionId !== "") {
    if (auth === null) {
      // Signing out must never depend on GitHub App configuration: with no
      // provider there is nothing to revoke, but the local session still has
      // to be destroyed.
      sessionStore.delete(sessionId);
    } else {
      await auth.logout(sessionId);
    }
  }

  clearSessionCookie(res);
  res.status(200).json({ success: true, data: { user: null } });
}
