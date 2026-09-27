import { AppError } from "../utils/appError.js";
import type { GithubAuthProvider, Session } from "./authTypes.js";
import type { SessionStore, StateStore } from "./sessionService.js";

/**
 * Orchestrates the authorization flow. Knows nothing about Express: it is
 * handed a code and a state and returns a session, which keeps it testable
 * without a server or a browser.
 */
export interface AuthService {
  /** Starts the flow, returning the GitHub URL to send the browser to. */
  beginAuthorization(): { url: string };
  /** Validates the callback and establishes a session. */
  completeAuthorization(
    code: unknown,
    state: unknown
  ): Promise<Session>;
  getSession(id: string): Session | null;
  /** Destroys the session and best-effort revokes the credential. */
  logout(id: string): Promise<void>;
}

export interface AuthServiceDeps {
  provider: GithubAuthProvider;
  sessions: SessionStore;
  states: StateStore;
}

export function createAuthService({
  provider,
  sessions,
  states,
}: AuthServiceDeps): AuthService {
  return {
    beginAuthorization() {
      const state = states.issue();
      return { url: provider.getAuthorizationUrl(state) };
    },

    async completeAuthorization(code, state) {
      // State is required, must be one we issued, and is consumed on use, so a
      // replayed or forged callback is rejected before anything else happens.
      if (typeof state !== "string" || state === "") {
        throw new AppError(400, "Invalid authorization callback");
      }
      if (!states.consume(state)) {
        throw new AppError(400, "Invalid authorization callback");
      }
      if (typeof code !== "string" || code === "") {
        throw new AppError(400, "Invalid authorization callback");
      }

      let credential;
      try {
        credential = await provider.exchangeCode(code);
      } catch {
        // The underlying error can carry the client secret or the code.
        throw new AppError(401, "GitHub authorization failed. Please try again.");
      }

      let user;
      try {
        user = await provider.fetchUser(credential);
      } catch {
        throw new AppError(401, "GitHub authorization failed. Please try again.");
      }

      return sessions.create(user, credential);
    },

    getSession(id) {
      return sessions.get(id);
    },

    async logout(id) {
      const session = sessions.get(id);
      // Drop the session first: local logout must succeed even if GitHub is
      // unreachable.
      sessions.delete(id);
      if (session !== null) {
        await provider.revoke(session.credential);
      }
    },
  };
}
