import dotenv from "dotenv";

dotenv.config();

/** Reads a positive integer from the environment, falling back when unusable. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Configuration errors are reported at startup, naming the variable and the
 * offending value.
 *
 * Without this a bad PORT surfaced as a bare RangeError from `listen()`, and a
 * malformed FRONTEND_URL surfaced much later as a 500 from the auth callback —
 * both a long way from the actual mistake.
 */
export function readPort(raw: string | undefined, fallback = 5000): number {
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535, but is ${JSON.stringify(raw)}`
    );
  }
  return parsed;
}

export function readFrontendUrl(
  raw: string | undefined,
  fallback = "http://localhost:5173"
): string {
  if (raw === undefined || raw.trim() === "") return fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `FRONTEND_URL must be an absolute http(s) URL, but is ${JSON.stringify(raw)}`
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `FRONTEND_URL must use http or https, but is ${JSON.stringify(raw)}`
    );
  }

  // Trailing slashes break an exact CORS origin comparison.
  return parsed.origin;
}

export const env = {
  port: readPort(process.env.PORT),
  frontendUrl: readFrontendUrl(process.env.FRONTEND_URL),
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
  /**
   * Bounds on Phase 4 dependency analysis. They protect backend memory,
   * GitHub API usage, parsing time and the size of the graph the browser has
   * to handle. Reaching one produces a partial, clearly-flagged analysis
   * rather than a failure.
   */
  analysis: {
    /** Source files parsed per repository. */
    maxSourceFiles: positiveInt(process.env.DRIFTWATCH_MAX_SOURCE_FILES, 600),
    /** Largest single file read from the archive (512 KB). */
    maxFileSizeBytes: positiveInt(
      process.env.DRIFTWATCH_MAX_FILE_SIZE_BYTES,
      512 * 1024
    ),
    /** Total source held in memory for one analysis (24 MB). */
    maxTotalSourceBytes: positiveInt(
      process.env.DRIFTWATCH_MAX_TOTAL_SOURCE_BYTES,
      24 * 1024 * 1024
    ),
    /**
     * Repositories larger than this are refused before the archive is
     * downloaded (250 MB), since the download itself would be the bottleneck.
     */
    maxRepositorySizeKb: positiveInt(
      process.env.DRIFTWATCH_MAX_REPO_SIZE_KB,
      250 * 1024
    ),
  },
  /**
   * Bounds on Phase 5 workflow analysis. Reaching one produces a partial,
   * clearly-flagged result rather than a failure.
   */
  workflows: {
    /** Workflow files parsed per repository. */
    maxWorkflows: positiveInt(process.env.DRIFTWATCH_MAX_WORKFLOWS, 50),
    /** Jobs kept per workflow. */
    maxJobsPerWorkflow: positiveInt(
      process.env.DRIFTWATCH_MAX_JOBS_PER_WORKFLOW,
      100
    ),
    /** Steps kept per job. */
    maxStepsPerJob: positiveInt(process.env.DRIFTWATCH_MAX_STEPS_PER_JOB, 100),
  },
};
