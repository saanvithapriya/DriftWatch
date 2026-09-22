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
};
