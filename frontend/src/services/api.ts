import type { CallGraphAnalysis } from "../types/callGraph";
import type { DependencyAnalysis } from "../types/dependencies";
import type { WorkflowAnalysis } from "../types/workflows";
import type { GithubTreeResponse, RepositoryTree } from "../types/github";
import type {
  CommitComparison,
  CommitDetail,
  FileHistory,
  HistoryStats,
  ImpactAnalysis,
  RepositoryHistory,
} from "../types/history";
import type { SchemaAnalysis } from "../types/schema";
import {
  parseCallGraphAnalysis,
  parseCommitComparison,
  parseCommitDetail,
  parseDependencyAnalysis,
  parseFileHistory,
  parseHistoryStats,
  parseImpactAnalysis,
  parseRepositoryHistory,
  parseRepositoryTree,
  parseSchemaAnalysis,
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

/**
 * Shared shape for every Phase 7 endpoint below: POST a JSON body, surface a
 * non-2xx response as an `ApiError` carrying the backend's own message, and
 * validate the payload's shape before it ever reaches the UI.
 */
async function postAndValidate<T>(
  path: string,
  body: Record<string, unknown>,
  parse: (payload: unknown) => T | null
): Promise<T> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(payload) ?? `Request failed with status ${response.status}`
    );
  }

  const envelope = payload as { success?: unknown; data?: unknown } | null;
  if (envelope === null || envelope.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  const data = parse(envelope.data);
  if (data === null) {
    throw new Error("Unexpected response from the server");
  }

  return data;
}

export interface HistoryQueryParams {
  page?: number;
  perPage?: number;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
}

/** Phase 7: paginated commit history for a repository. */
export function fetchCommitHistory(
  url: string,
  params: HistoryQueryParams = {}
): Promise<RepositoryHistory> {
  return postAndValidate("/api/github/history", { url, ...params }, parseRepositoryHistory);
}

/** Phase 7: full detail (stats + changed files) for one commit. */
export function fetchCommitDetail(url: string, sha: string): Promise<CommitDetail> {
  return postAndValidate("/api/github/commit", { url, sha }, parseCommitDetail);
}

/** Phase 7: changed files and stats between two commits/refs. */
export function compareCommits(
  url: string,
  base: string,
  head: string
): Promise<CommitComparison> {
  return postAndValidate("/api/github/compare", { url, base, head }, parseCommitComparison);
}

/** Phase 7: commit history scoped to one file path, plus evolution stats. */
export function fetchFileHistory(
  url: string,
  path: string,
  params: { page?: number; perPage?: number } = {}
): Promise<FileHistory> {
  return postAndValidate("/api/github/file-history", { url, path, ...params }, parseFileHistory);
}

/**
 * Phase 7: change hotspots and contributor activity, derived from
 * inspecting each commit in the given page individually. Noticeably more
 * expensive than plain history — only called when the user opens that
 * section, never automatically.
 */
export function fetchHistoryStats(
  url: string,
  params: HistoryQueryParams = {}
): Promise<HistoryStats> {
  return postAndValidate("/api/github/history-stats", { url, ...params }, parseHistoryStats);
}

/**
 * Phase 7: static, dependency-graph-based impact analysis between two
 * commits. Statically inferred from repository history and dependency
 * relationships — never a prediction of runtime failure.
 */
export function analyzeImpact(
  url: string,
  base: string,
  head: string,
  maxDepth?: number
): Promise<ImpactAnalysis> {
  return postAndValidate(
    "/api/github/impact",
    maxDepth === undefined ? { url, base, head } : { url, base, head, maxDepth },
    parseImpactAnalysis
  );
}

/**
 * Phase 8: database schema statically discovered from Prisma/SQL/Mongoose
 * source files and normalized into one provider-independent graph. Never
 * connects to or executes against a live database.
 */
export function analyzeSchema(url: string): Promise<SchemaAnalysis> {
  return postAndValidate("/api/github/schema", { url }, parseSchemaAnalysis);
}
