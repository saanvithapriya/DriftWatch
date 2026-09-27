import type { GithubTreeResponse, RepositoryTree } from "../types/github";
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

/** Reads the backend's `{ success: false, message }` shape, if present. */
function readErrorMessage(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return null;
}

/**
 * Confirms a payload really is a `RepositoryTree` before it reaches the UI.
 *
 * Without this, a backend that answered `{ success: true }` with the wrong
 * shape would propagate `undefined` into the rendering code and take the whole
 * React tree down with an uncaught TypeError, leaving a blank page and no way
 * to recover. A shape mismatch is reported as an ordinary error instead.
 */
function parseRepositoryTree(payload: unknown): RepositoryTree | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  const repository = data.repository;
  if (typeof repository !== "object" || repository === null) return null;
  const repo = repository as Record<string, unknown>;
  if (
    typeof repo.owner !== "string" ||
    typeof repo.name !== "string" ||
    typeof repo.defaultBranch !== "string"
  ) {
    return null;
  }

  if (!Array.isArray(data.tree)) return null;
  for (const node of data.tree) {
    if (typeof node !== "object" || node === null) return null;
    const entry = node as Record<string, unknown>;
    if (typeof entry.path !== "string") return null;
    if (entry.type !== "file" && entry.type !== "directory") return null;
  }

  if (typeof data.truncated !== "boolean") return null;

  return {
    repository: {
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    },
    tree: data.tree as RepositoryTree["tree"],
    truncated: data.truncated,
  };
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
