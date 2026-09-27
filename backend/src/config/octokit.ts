import { Octokit } from "octokit";
import type { GithubCredential } from "../types/github.js";
import { env } from "./env.js";

const USER_AGENT = "repo-intelligence-platform";

/**
 * The anonymous client is shared because it carries no user identity: it is
 * either unauthenticated or uses the server's own optional GITHUB_TOKEN, which
 * exists only to raise the rate limit.
 */
let anonymousClient: Octokit | undefined;

/**
 * Client for public repository access, with no user credential attached.
 */
export function getOctokit(): Octokit {
  if (anonymousClient === undefined) {
    anonymousClient = new Octokit({
      auth: env.githubToken,
      userAgent: USER_AGENT,
    });
  }

  return anonymousClient;
}

/**
 * Client bound to one user's GitHub credential.
 *
 * Deliberately **never cached**. A module-level cache keyed on nothing would
 * let one user's credential serve another user's request, which is the single
 * most dangerous mistake available in this file. Constructing a client is
 * cheap; sharing one across identities is not.
 */
export function getAuthenticatedOctokit(credential: GithubCredential): Octokit {
  return new Octokit({
    auth: credential.token,
    userAgent: USER_AGENT,
  });
}

/**
 * Picks the right client for a request. Passing no credential yields the
 * anonymous client, which is what keeps public repository access working
 * exactly as it did before authentication existed.
 *
 * This module knows nothing about sessions, cookies or Express — it is handed
 * a credential or it is not.
 */
export function resolveOctokit(credential?: GithubCredential): Octokit {
  return credential === undefined
    ? getOctokit()
    : getAuthenticatedOctokit(credential);
}

/** Test seam: drops the cached anonymous client. */
export function resetAnonymousOctokit(): void {
  anonymousClient = undefined;
}
