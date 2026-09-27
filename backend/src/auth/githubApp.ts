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
export function isGithubAppConfigured(): boolean {
  const { clientId, clientSecret, callbackUrl } = env.githubApp;
  return clientId !== undefined && clientSecret !== undefined && callbackUrl !== undefined;
}

export function createGithubAuthProvider(): GithubAuthProvider {
  const { clientId, clientSecret, callbackUrl } = env.githubApp;

  if (clientId === undefined || clientSecret === undefined || callbackUrl === undefined) {
    throw new Error("GitHub App is not configured");
  }

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
