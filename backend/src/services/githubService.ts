import { resolveOctokit } from "../config/octokit.js";
import { AppError } from "../utils/appError.js";
import type {
  GithubCredential,
  RepositoryTree,
  RepositoryTreeNode,
} from "../types/github.js";

interface GithubApiError {
  status: number;
  message?: string;
  response?: { headers?: Record<string, unknown> };
}

export function isGithubApiError(error: unknown): error is GithubApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

/**
 * GitHub answers an exhausted *primary* rate limit with 403, not 429, so a
 * 403 cannot be assumed to mean "forbidden". The two are separated by the
 * rate-limit headers GitHub sends alongside, falling back to the message.
 */
function isRateLimited(error: GithubApiError): boolean {
  const remaining = error.response?.headers?.["x-ratelimit-remaining"];
  if (remaining === "0" || remaining === 0) return true;

  const retryAfter = error.response?.headers?.["retry-after"];
  if (typeof retryAfter === "string" && retryAfter !== "") return true;

  return /rate limit|abuse detection/i.test(error.message ?? "");
}

/**
 * Translates an Octokit failure into a client-safe AppError.
 *
 * Raw Octokit errors never leave this module: their messages can carry request
 * details, so every branch returns a fixed message of our own.
 *
 *   401 -> the credential is missing, expired or revoked
 *   403 -> the credential is valid but access is restricted (or rate limited)
 *   404 -> not found, which for a private repository is GitHub deliberately
 *          hiding existence; it is relayed unchanged so we do not leak it
 *   429 -> rate limited
 */
export function toAppError(error: unknown): AppError {
  if (isGithubApiError(error)) {
    if (error.status === 401) {
      return new AppError(
        401,
        "GitHub authentication failed. Please reconnect your GitHub account."
      );
    }

    if (error.status === 429 || (error.status === 403 && isRateLimited(error))) {
      return new AppError(
        429,
        "GitHub API rate limit exceeded. Please try again later."
      );
    }

    if (error.status === 403) {
      return new AppError(
        403,
        "Access to this GitHub repository is restricted by GitHub or its organization."
      );
    }

    if (error.status === 404) {
      // GitHub returns 404 rather than 403 for private repositories the caller
      // cannot see. Saying anything more here would leak their existence.
      return new AppError(404, "GitHub repository not found");
    }
  }

  return new AppError(502, "Failed to fetch GitHub repository");
}

/**
 * Normalizes GitHub's Git Tree entries into domain nodes.
 *
 * `blob` becomes `file` and `tree` becomes `directory`. Other entry kinds —
 * `commit`, which represents a submodule — are dropped, since they are not
 * part of this repository's own file tree.
 */
export function normalizeTreeEntries(
  entries: ReadonlyArray<{ path?: string; type?: string }>
): RepositoryTreeNode[] {
  const nodes: RepositoryTreeNode[] = [];

  for (const entry of entries) {
    if (typeof entry.path !== "string" || entry.path === "") continue;

    if (entry.type === "blob") {
      nodes.push({ path: entry.path, type: "file" });
    } else if (entry.type === "tree") {
      nodes.push({ path: entry.path, type: "directory" });
    }
  }

  return nodes;
}

/**
 * Fetches a public repository's file tree.
 *
 * The default branch is read from the repository metadata rather than assumed
 * to be `main` or `master`, and the tree is requested recursively so nested
 * directories are included.
 *
 * This function is the single ingestion entry point, so a cache can later wrap
 * it without changing the API contract.
 *
 * WARNING for any future cache: once private repositories are reachable, a
 * cache key of `owner/repo` alone is a data leak. Two callers can ask for the
 * same repository and legitimately be entitled to different answers, so the
 * key must include the authorization boundary (the credential's identity), and
 * anonymous results must never be served to authenticated callers or the
 * reverse. Caching is deliberately not implemented here.
 */
export interface RepositorySnapshot extends RepositoryTree {
  /** Repository size in kilobytes, as GitHub reports it. */
  sizeKb: number;
}

/**
 * Fetches repository metadata and its recursive tree.
 *
 * Shared by Phase 1's tree endpoint and Phase 4's dependency analysis so that
 * neither duplicates the GitHub calls or the error handling. Two API calls.
 */
export async function fetchRepositorySnapshot(
  owner: string,
  repo: string,
  credential?: GithubCredential
): Promise<RepositorySnapshot> {
  // The credential simply arrives; this module never works out who the caller
  // is, never reads a request, a cookie or a session.
  const octokit = resolveOctokit(credential);

  let defaultBranch: string;
  let canonicalOwner: string;
  let canonicalName: string;
  let sizeKb: number;

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = data.default_branch;
    canonicalOwner = data.owner.login;
    canonicalName = data.name;
    sizeKb = typeof data.size === "number" ? data.size : 0;
  } catch (error) {
    throw toAppError(error);
  }

  const repository = {
    owner: canonicalOwner,
    name: canonicalName,
    defaultBranch,
  };

  try {
    const { data } = await octokit.rest.git.getTree({
      owner: canonicalOwner,
      repo: canonicalName,
      tree_sha: defaultBranch,
      recursive: "1",
    });

    return {
      repository,
      tree: normalizeTreeEntries(data.tree),
      // GitHub sets this when the tree was too large to return in full. It is
      // passed through so the frontend never treats a partial tree as complete.
      truncated: data.truncated === true,
      sizeKb,
    };
  } catch (error) {
    // A repository with no commits yet has no tree to resolve; that is an
    // empty repository rather than a failure.
    if (isGithubApiError(error) && error.status === 409) {
      return { repository, tree: [], truncated: false, sizeKb };
    }

    throw toAppError(error);
  }
}

/**
 * Phase 1's repository tree. Unchanged contract: the snapshot's extra
 * metadata is internal and never reaches the API response.
 */
export async function fetchRepositoryTree(
  owner: string,
  repo: string,
  credential?: GithubCredential
): Promise<RepositoryTree> {
  const { repository, tree, truncated } = await fetchRepositorySnapshot(
    owner,
    repo,
    credential
  );
  return { repository, tree, truncated };
}
