import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  /**
   * Optional. Public repository ingestion works without it; when set, it only
   * raises the GitHub API rate limit. Users are never asked to supply a token.
   */
  githubToken: process.env.GITHUB_TOKEN || undefined,
  /**
   * GitHub App credentials for the user authorization (user-to-server) flow.
   *
   * Only the client id/secret and callback are needed: the app's private key
   * and App ID are required solely for server-to-server installation tokens,
   * which this application does not mint. The secret stays in this process and
   * is never sent to the browser.
   *
   * When unset, authentication is simply unavailable and anonymous public
   * repository analysis continues to work.
   */
  githubApp: {
    clientId: process.env.GITHUB_APP_CLIENT_ID || undefined,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || undefined,
    callbackUrl: process.env.GITHUB_APP_CALLBACK_URL || undefined,
  },
  /**
   * Set to "true" when the backend is served over HTTPS so the session cookie
   * carries the Secure attribute. Left false for local http://localhost.
   */
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "true",
};
