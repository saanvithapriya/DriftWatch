import { createAuthService, type AuthService } from "./authService.js";
import { createGithubAuthProvider, isGithubAppConfigured } from "./githubApp.js";
import {
  createInMemorySessionStore,
  createInMemoryStateStore,
  type SessionStore,
  type StateStore,
} from "./sessionService.js";

/**
 * Process-wide auth wiring.
 *
 * The stores always exist so session lookup works; the auth service only
 * exists once a GitHub App is configured. With no configuration the app still
 * boots and serves anonymous public repository analysis.
 */
export const sessionStore: SessionStore = createInMemorySessionStore();
export const stateStore: StateStore = createInMemoryStateStore();

let authService: AuthService | null | undefined;

export function getAuthService(): AuthService | null {
  if (authService === undefined) {
    authService = isGithubAppConfigured()
      ? createAuthService({
          provider: createGithubAuthProvider(),
          sessions: sessionStore,
          states: stateStore,
        })
      : null;
  }
  return authService;
}
