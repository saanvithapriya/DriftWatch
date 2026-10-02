import type { CallGraphAnalysis } from "../types/callGraph";
import type { DependencyAnalysis } from "../types/dependencies";
import type { WorkflowAnalysis } from "../types/workflows";
import type { GithubTreeResponse, RepositoryTree } from "../types/github";
import {
  parseCallGraphAnalysis,
  parseDependencyAnalysis,
  parseRepositoryTree,
  parseWorkflowAnalysis,
  readErrorMessage,
} from "./responseContract";
import type { HealthResponse } from "../types/health";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Error carrying the HTTP status, so the UI can respond to *why* a request
 * failed (for example offering to connect GitHub on a 404) without parsing
 * message strings.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Performs a request, turning a network-level failure into a message that
 * says what actually went wrong.
 *
 * `fetch` rejects with a bare "Failed to fetch" when it cannot reach the
 * server at all, which gives no hint that the backend simply is not running.
 */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    // Credentials are always included so the HttpOnly session cookie is sent.
    // The backend allows exactly one origin, never a wildcard.
    return await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  } catch {
    throw new Error(
      `Could not reach the backend at ${API_URL}. Make sure it is running (npm run dev).`
    );
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await request("/api/health");

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json();
}

export async function analyzeGithubRepository(
  url: string
): Promise<RepositoryTree> {
  const response = await request("/api/github/tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(payload) ??
        `Request failed with status ${response.status}`
    );
  }

  const body = payload as GithubTreeResponse | null;
  if (body === null || body.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  const data = parseRepositoryTree(body.data);
  if (data === null) {
    throw new Error("Unexpected response from the server");
  }

  return data;
}

/** Phase 4: source-file dependency graph for a repository. */
export async function analyzeDependencies(
  url: string
): Promise<DependencyAnalysis> {
  const response = await request("/api/github/dependencies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(payload) ?? `Request failed with status ${response.status}`
    );
  }

  const body = payload as { success?: unknown; data?: unknown } | null;
  if (body === null || body.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  const data = parseDependencyAnalysis(body.data);
  if (data === null) {
    throw new Error("Unexpected response from the server");
  }

  return data;
}

/** Phase 5: GitHub Actions workflow analysis for a repository. */
export async function analyzeWorkflows(url: string): Promise<WorkflowAnalysis> {
  const response = await request("/api/github/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(payload) ?? `Request failed with status ${response.status}`
    );
  }

  const body = payload as { success?: unknown; data?: unknown } | null;
  if (body === null || body.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  const data = parseWorkflowAnalysis(body.data);
  if (data === null) {
    throw new Error("Unexpected response from the server");
  }

  return data;
}

/**
 * Phase 6: static function call graph for a repository, from `entryPoint`
 * (or the backend's own deterministic default when omitted). This is
 * statically inferred from source text — it is never runtime tracing.
 */
export async function analyzeCallGraph(
  url: string,
  entryPoint?: string
): Promise<CallGraphAnalysis> {
  const response = await request("/api/github/call-graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entryPoint === undefined ? { url } : { url, entryPoint }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(payload) ?? `Request failed with status ${response.status}`
    );
  }

  const body = payload as { success?: unknown; data?: unknown } | null;
  if (body === null || body.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  const data = parseCallGraphAnalysis(body.data);
  if (data === null) {
    throw new Error("Unexpected response from the server");
  }

  return data;
}
