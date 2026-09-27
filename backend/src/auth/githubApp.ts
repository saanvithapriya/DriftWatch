import { OAuthApp, type Options } from "@octokit/oauth-app";
import { Octokit } from "octokit";
import { env } from "../config/env.js";
import type { GithubCredential } from "../types/github.js";
import type { GithubAuthProvider, SessionUser } from "./authTypes.js";

/**
 * GitHub App user authorization ("user-to-server") flow.
 *
 * A GitHub App is used rather than an OAuth App so access is bounded by where
 * the app is installed and by the app's declared repository permissions,
 * instead of a broad account-wide `repo` scope.
 *
 * Only the web authorization flow is used, so only the client id/secret are
 * required. The app's private key and App ID are needed solely for
 * server-to-server (installation/JWT) authentication, which this phase does
 * not perform — so they are deliberately not configuration here, and the
 * private key never exists in this process at all.
 */
/**
 * Whether GitHub sign-in can run, and if not, why.
 *
 * Three outcomes are distinguished so a developer is told the difference
 * between "you have not set this up" and "you set up half of it":
 *
 *   unconfigured — no credentials at all; anonymous public analysis is the
 *                  intended mode and the sign-in route simply reports this
 *   partial      — some but not all credentials; almost always a typo or a
 *                  half-finished .env, and worth naming the gap
 *   configured   — ready to run the authorization flow
 *
 * `missing` contains variable *names* only. Secret values are never read into
 * a message, logged, or returned.
 */
export type GithubAppConfig =
  | { status: "configured"; clientId: string; clientSecret: string; callbackUrl: string }
  | { status: "unconfigured" }
  | { status: "partial"; missing: string[] };

/** Credentials that must be supplied; the callback URL has a local default. */
const REQUIRED_CREDENTIALS = [
  ["GITHUB_APP_CLIENT_ID", "clientId"],
  ["GITHUB_APP_CLIENT_SECRET", "clientSecret"],
] as const;

export interface GithubAppCredentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
  callbackUrl: string;
}

/**
 * Takes the credentials to inspect so every configuration state can be tested
 * without touching the process environment or holding real credentials.
 */
export function inspectGithubAppConfig(
  source: GithubAppCredentials = env.githubApp
): GithubAppConfig {
  const { clientId, clientSecret, callbackUrl } = source;

  const missing = REQUIRED_CREDENTIALS.filter(
    ([, key]) => source[key] === undefined
  ).map(([name]) => name);

  if (missing.length === REQUIRED_CREDENTIALS.length) {
    return { status: "unconfigured" };
  }
  if (missing.length > 0) {
    return { status: "partial", missing };
  }

  return {
    status: "configured",
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    callbackUrl,
  };
}

export function isGithubAppConfigured(): boolean {
  return inspectGithubAppConfig().status === "configured";
}

export function createGithubAuthProvider(): GithubAuthProvider {
  const config = inspectGithubAppConfig();
  if (config.status !== "configured") {
    throw new Error("GitHub App is not configured");
  }
  const { clientId, clientSecret, callbackUrl } = config;

  // The generic is explicit: OAuthApp defaults to the OAuth-App shape, and
  // without it TypeScript resolves the GitHub-App methods to `never`.
  const oauthApp = new OAuthApp<Options<"github-app">>({
    clientType: "github-app",
    clientId,
    clientSecret,
  });

  return {
    getAuthorizationUrl(state) {
      const { url } = oauthApp.getWebFlowAuthorizationUrl({
        state,
        redirectUrl: callbackUrl,
      });
      return url;
    },

    async exchangeCode(code) {
      const { authentication } = await oauthApp.createToken({ code });
      return { token: authentication.token };
    },

    async fetchUser(credential): Promise<SessionUser> {
      const octokit = new Octokit({ auth: credential.token });
      const { data } = await octokit.rest.users.getAuthenticated();
      return {
        id: data.id,
        login: data.login,
        name: data.name ?? null,
        avatarUrl: data.avatar_url,
      };
    },

    async revoke(credential: GithubCredential) {
      // Best effort: a token GitHub has already invalidated will 404 here, and
      // failing to revoke must not stop the local session being destroyed.
      try {
        await oauthApp.deleteToken({ token: credential.token });
      } catch {
        // Intentionally ignored; the session is dropped regardless.
      }
    },
  };
}
