import { API_URL, request } from "../services/api";

/**
 * The only user information the browser ever sees. The GitHub credential
 * stays on the server, inside the session, and is never sent here.
 */
export interface AuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

interface MeResponse {
  success: boolean;
  data?: { user: AuthUser | null };
}

function parseUser(payload: unknown): AuthUser | null {
  if (typeof payload !== "object" || payload === null) return null;
  const user = (payload as { data?: { user?: unknown } }).data?.user;
  if (typeof user !== "object" || user === null) return null;

  const candidate = user as Record<string, unknown>;
  if (
    typeof candidate.id !== "number" ||
    typeof candidate.login !== "string" ||
    typeof candidate.avatarUrl !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    login: candidate.login,
    name: typeof candidate.name === "string" ? candidate.name : null,
    avatarUrl: candidate.avatarUrl,
  };
}

/** Returns the signed-in user, or null when signed out or unreachable. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await request("/api/auth/me");
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as MeResponse | null;
  return parseUser(payload);
}

export async function signOut(): Promise<void> {
  await request("/api/auth/logout");
}

/**
 * Full-page navigation, not fetch: the browser has to follow GitHub's
 * redirects and come back with the session cookie set.
 */
export function githubConnectUrl(): string {
  return `${API_URL}/api/auth/github`;
}
