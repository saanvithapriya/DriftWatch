import type { GithubCredential } from "../types/github.js";

/**
 * The only user information that is ever allowed to reach the browser.
 * Deliberately excludes anything credential-shaped.
 */
export interface SessionUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

/**
 * A server-side session. The GitHub credential lives here and nowhere else;
 * the browser only ever holds the opaque `id` in an HttpOnly cookie.
 */
export interface Session {
  id: string;
  user: SessionUser;
  credential: GithubCredential;
  createdAt: number;
  expiresAt: number;
}

/**
 * Everything the auth flow needs from GitHub, behind an interface so the tests
 * can exercise the flow without network access or a browser login.
 */
export interface GithubAuthProvider {
  /** Authorization URL the browser is redirected to, carrying our CSRF state. */
  getAuthorizationUrl(state: string): string;
  /** Exchanges the callback code for a user credential. */
  exchangeCode(code: string): Promise<GithubCredential>;
  /** Reads the safe profile fields for the credential's owner. */
  fetchUser(credential: GithubCredential): Promise<SessionUser>;
  /** Best-effort revocation on logout. */
  revoke(credential: GithubCredential): Promise<void>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Populated by `attachSession` when a valid session cookie is present.
       * Absent for anonymous requests, which remain fully supported.
       */
      driftwatchSession?: Session;
    }
  }
}

export {};
