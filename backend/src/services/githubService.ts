import { getOctokit } from "../config/octokit.js";
import { AppError } from "../utils/appError.js";
import type {
  RepositoryTree,
  RepositoryTreeNode,
} from "../types/github.js";

interface GithubApiError {
  status: number;
}

function isGithubApiError(error: unknown): error is GithubApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

/**
 * Translates an Octokit failure into a client-safe AppError. Raw Octokit
 * errors never leave this module.
 */
function toAppError(error: unknown): AppError {
  if (isGithubApiError(error)) {
    if (error.status === 404) {
      return new AppError(404, "GitHub repository not found");
    }
    if (error.status === 403 || error.status === 429) {
      return new AppError(
        429,
        "GitHub API rate limit exceeded. Please try again later."
      );
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
function normalizeTreeEntries(
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
 */
export async function fetchRepositoryTree(
  owner: string,
  repo: string
): Promise<RepositoryTree> {
  const octokit = getOctokit();

  let defaultBranch: string;
  let canonicalOwner: string;
  let canonicalName: string;

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = data.default_branch;
    canonicalOwner = data.owner.login;
    canonicalName = data.name;
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
    };
  } catch (error) {
    // A repository with no commits yet has no tree to resolve; that is an
    // empty repository rather than a failure.
    if (isGithubApiError(error) && error.status === 409) {
      return { repository, tree: [], truncated: false };
    }

    throw toAppError(error);
  }
}
