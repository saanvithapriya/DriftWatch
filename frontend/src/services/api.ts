import type { GithubTreeResponse, RepositoryTree } from "../types/github";
import type { HealthResponse } from "../types/health";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/** Reads the backend's `{ success: false, message }` shape, if present. */
function readErrorMessage(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return null;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json();
}

export async function analyzeGithubRepository(
  url: string
): Promise<RepositoryTree> {
  const response = await fetch(`${API_URL}/api/github/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Request failed with status ${response.status}`
    );
  }

  const body = payload as GithubTreeResponse | null;
  if (body === null || body.success !== true) {
    throw new Error("Unexpected response from the server");
  }

  return body.data;
}
