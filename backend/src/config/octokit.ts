import { Octokit } from "octokit";
import { env } from "./env.js";

let client: Octokit | undefined;

/**
 * Single shared Octokit client for public repository access.
 *
 * Authentication is optional here: without a token Octokit talks to GitHub
 * anonymously, which is all public repositories require. This factory is the
 * only place that constructs a client, so per-user authentication can be
 * introduced later without touching the ingestion service.
 */
export function getOctokit(): Octokit {
  if (client === undefined) {
    client = new Octokit({
      auth: env.githubToken,
      userAgent: "repo-intelligence-platform",
    });
  }

  return client;
}
