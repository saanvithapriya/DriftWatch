import { env } from "../config/env.js";
import { resolveOctokit } from "../config/octokit.js";
import type {
  ChangeHotspot,
  ChangedFile,
  ChangedFileStatus,
  CommitAuthor,
  CommitComparison,
  CommitDetail,
  CommitStats,
  CommitSummary,
  ContributorStats,
  FileEvolutionStats,
  FileHistory,
  FileHistoryEntry,
  HistoryPagination,
  HistoryStats,
  RepositoryHistory,
} from "../types/history.js";
import type { GithubCredential } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { fetchRepositoryInfo, isGithubApiError, toAppError } from "./githubService.js";
import { callerIdentity, createScopedCache } from "./scopedCache.js";

/**
 * Phase 7: commit history, commit detail, comparison, file history and
 * history-derived statistics.
 *
 * Every GitHub call goes through `resolveOctokit`, exactly like every other
 * service — the credential arrives already resolved and stops here. Commit
 * messages, author names and file paths are repository-controlled strings:
 * they are described, never executed, never interpolated into a shell, and
 * reach the frontend as plain data for React to render as text.
 */

// ── validation ───────────────────────────────────────────────────────────

const SHA_LIKE_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * Accepts a sha or a ref (branch/tag) name, rejecting anything that could
 * confuse GitHub's `base...head` compare syntax or that is simply not a
 * plausible git identifier. `...` is rejected outright: it is the compare
 * endpoint's own separator, and a ref legitimately never contains it.
 */
export function validateGitRef(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new AppError(400, `${field} is required`);
  }
  if (!SHA_LIKE_PATTERN.test(value) || value.includes("..")) {
    throw new AppError(400, `${field} is not a valid commit SHA or ref`);
  }
  return value;
}

function validatePage(raw: unknown): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, "page must be a positive integer");
  return n;
}

function validatePerPage(raw: unknown): number {
  const max = env.history.maxHistoryCommits;
  if (raw === undefined) return Math.min(30, max);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError(400, "perPage must be a positive integer");
  }
  return Math.min(n, max);
}

function validateOptionalString(raw: unknown, field: string, maxLength = 300): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length > maxLength) {
    throw new AppError(400, `${field} is invalid`);
  }
  return raw;
}

/** `since`/`until` must be ISO 8601 — GitHub rejects anything else anyway,
 *  but validating here keeps the error a clean 400 instead of an upstream 422. */
function validateOptionalDate(raw: unknown, field: string): string | undefined {
  const value = validateOptionalString(raw, field, 64);
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(400, `${field} must be a valid date`);
  }
  return value;
}

export interface HistoryQuery {
  page?: unknown;
  perPage?: unknown;
  author?: unknown;
  path?: unknown;
  since?: unknown;
  until?: unknown;
}

export interface ValidatedHistoryQuery {
  page: number;
  perPage: number;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
}

export function validateHistoryQuery(query: HistoryQuery): ValidatedHistoryQuery {
  const result: ValidatedHistoryQuery = {
    page: validatePage(query.page),
    perPage: validatePerPage(query.perPage),
  };
  const author = validateOptionalString(query.author, "author", 100);
  if (author !== undefined) result.author = author;
  const path = validateOptionalString(query.path, "path", 1000);
  if (path !== undefined) result.path = path;
  const since = validateOptionalDate(query.since, "since");
  if (since !== undefined) result.since = since;
  const until = validateOptionalDate(query.until, "until");
  if (until !== undefined) result.until = until;
  return result;
}

// ── mapping ──────────────────────────────────────────────────────────────

export interface RawGitIdentity {
  name?: string | null;
  email?: string | null;
  date?: string | null;
}

export interface RawGithubUser {
  login?: string | null;
  avatar_url?: string | null;
}

export function toCommitAuthor(
  identity: RawGitIdentity | null | undefined,
  user: RawGithubUser | null | undefined
): CommitAuthor {
  return {
    name: identity?.name ?? "",
    email: identity?.email ?? "",
    login: user?.login ?? null,
    avatarUrl: user?.avatar_url ?? null,
  };
}

export interface RawCommit {
  sha: string;
  html_url?: string | null;
  commit: {
    message: string;
    author?: RawGitIdentity | null;
    committer?: RawGitIdentity | null;
  };
  author?: RawGithubUser | null;
  committer?: RawGithubUser | null;
}

export function toCommitSummary(raw: RawCommit): CommitSummary {
  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    message: raw.commit.message,
    author: toCommitAuthor(raw.commit.author, raw.author),
    committer: toCommitAuthor(raw.commit.committer, raw.committer),
    date: raw.commit.author?.date ?? raw.commit.committer?.date ?? "",
    url: raw.html_url ?? "",
  };
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

export interface RawFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  previous_filename?: string;
  patch?: string;
}

export function toChangedFile(raw: RawFile): ChangedFile {
  const status: ChangedFileStatus = VALID_STATUSES.has(raw.status ?? "")
    ? (raw.status as ChangedFileStatus)
    : "changed";

  return {
    path: raw.filename,
    status,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changes: raw.changes ?? 0,
    previousPath: raw.previous_filename ?? null,
    patchAvailable: typeof raw.patch === "string",
  };
}

/** Caps a file list, reporting whether anything was left out. */
export function capFiles(files: RawFile[]): { files: ChangedFile[]; truncated: boolean } {
  const max = env.history.maxCommitFiles;
  return {
    files: files.slice(0, max).map(toChangedFile),
    truncated: files.length > max,
  };
}

/** GitHub signals another page via a `rel="next"` entry in the Link header. */
export function hasNextPage(linkHeader: string | undefined): boolean {
  return typeof linkHeader === "string" && /rel="next"/.test(linkHeader);
}

/**
 * Error translation for a single commit or comparison lookup.
 *
 * `toAppError`'s shared 404 mapping ("GitHub repository not found") is
 * correct for `repos.get`/`git.getTree`, but misleading here: a 404 from
 * `compareCommitsWithBasehead` means the base or head ref was not found, not
 * the repository. GitHub also answers a well-formed but nonexistent commit
 * SHA with 422 (section 22's "invalid comparison"), which the shared mapper
 * has no branch for at all and would otherwise fall through to a generic
 * 502. Deliberately layered on top of, not a replacement for, the shared
 * mapper — everything else (401/403/429/500) still goes through it
 * unchanged, so Phase 1–5 behaviour for `repos.get` is untouched.
 */
function toCommitLookupError(error: unknown): AppError {
  if (isGithubApiError(error)) {
    if (error.status === 422) {
      return new AppError(422, "One or both commit references could not be found or compared");
    }
    if (error.status === 404) {
      return new AppError(404, "Commit not found");
    }
  }
  return toAppError(error);
}

// ── caches ───────────────────────────────────────────────────────────────

const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const historyCache = createScopedCache<RepositoryHistory>(HISTORY_CACHE_TTL_MS, 50);
const commitCache = createScopedCache<CommitDetail>(HISTORY_CACHE_TTL_MS, 100);
const compareCache = createScopedCache<CommitComparison>(HISTORY_CACHE_TTL_MS, 50);
const fileHistoryCache = createScopedCache<FileHistory>(HISTORY_CACHE_TTL_MS, 50);
const historyStatsCache = createScopedCache<HistoryStats>(HISTORY_CACHE_TTL_MS, 30);

function repoKey(owner: string, repo: string, credential?: GithubCredential): string {
  return `${callerIdentity(credential)}::${owner}/${repo}`;
}

// ── commit history ──────────────────────────────────────────────────────

export async function fetchCommitHistory(
  owner: string,
  repo: string,
  query: ValidatedHistoryQuery,
  credential?: GithubCredential
): Promise<RepositoryHistory> {
  const key = `${repoKey(owner, repo, credential)}::${JSON.stringify(query)}`;
  const cached = historyCache.get(key);
  if (cached !== null) return cached;

  const repository = await fetchRepositoryInfo(owner, repo, credential);
  const octokit = resolveOctokit(credential);

  let response;
  try {
    response = await octokit.rest.repos.listCommits({
      owner: repository.owner,
      repo: repository.name,
      page: query.page,
      per_page: query.perPage,
      author: query.author,
      path: query.path,
      since: query.since,
      until: query.until,
    });
  } catch (error) {
    throw toAppError(error);
  }

  const result: RepositoryHistory = {
    repository,
    // GitHub's own order (newest first by commit date) is trusted as-is —
    // the same request, repeated, returns the same order.
    commits: response.data.map((c) => toCommitSummary(c as RawCommit)),
    pagination: {
      page: query.page,
      perPage: query.perPage,
      hasNextPage: hasNextPage(response.headers.link),
    } satisfies HistoryPagination,
  };

  historyCache.set(key, result);
  return result;
}

// ── commit detail ───────────────────────────────────────────────────────

export async function fetchCommitDetail(
  owner: string,
  repo: string,
  sha: string,
  credential?: GithubCredential
): Promise<CommitDetail> {
  const key = `${repoKey(owner, repo, credential)}::${sha}`;
  const cached = commitCache.get(key);
  if (cached !== null) return cached;

  const repository = await fetchRepositoryInfo(owner, repo, credential);
  const octokit = resolveOctokit(credential);

  let data;
  try {
    ({ data } = await octokit.rest.repos.getCommit({
      owner: repository.owner,
      repo: repository.name,
      ref: sha,
    }));
  } catch (error) {
    throw toCommitLookupError(error);
  }

  const { files, truncated } = capFiles((data.files ?? []) as RawFile[]);

  const result: CommitDetail = {
    commit: toCommitSummary(data as RawCommit),
    stats: {
      filesChanged: data.files?.length ?? 0,
      additions: data.stats?.additions ?? 0,
      deletions: data.stats?.deletions ?? 0,
    } satisfies CommitStats,
    files,
    filesTruncated: truncated,
  };

  commitCache.set(key, result);
  return result;
}

// ── compare ──────────────────────────────────────────────────────────────

export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
  credential?: GithubCredential
): Promise<CommitComparison> {
  const key = `${repoKey(owner, repo, credential)}::${base}...${head}`;
  const cached = compareCache.get(key);
  if (cached !== null) return cached;

  const repository = await fetchRepositoryInfo(owner, repo, credential);
  const octokit = resolveOctokit(credential);

  let data;
  try {
    ({ data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: repository.owner,
      repo: repository.name,
      basehead: `${base}...${head}`,
    }));
  } catch (error) {
    throw toCommitLookupError(error);
  }

  const rawFiles = (data.files ?? []) as RawFile[];
  const { files, truncated } = capFiles(rawFiles);
  const headCommit =
    data.commits.length > 0
      ? toCommitSummary(data.commits[data.commits.length - 1] as RawCommit)
      : toCommitSummary(data.base_commit as RawCommit);

  const result: CommitComparison = {
    repository,
    base: toCommitSummary(data.base_commit as RawCommit),
    head: headCommit,
    stats: {
      filesChanged: rawFiles.length,
      additions: rawFiles.reduce((sum, f) => sum + (f.additions ?? 0), 0),
      deletions: rawFiles.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    },
    files,
    filesTruncated: truncated,
  };

  compareCache.set(key, result);
  return result;
}

// ── file history ─────────────────────────────────────────────────────────

const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export function computeFileEvolutionStats(entries: FileHistoryEntry[]): FileEvolutionStats {
  const authors = new Set<string>();
  let sizedCount = 0;
  let sizedTotal = 0;
  let recentCount = 0;
  const now = Date.now();

  for (const entry of entries) {
    authors.add(entry.author.login ?? (entry.author.email || entry.author.name));
    if (entry.additions !== undefined && entry.deletions !== undefined) {
      sizedCount += 1;
      sizedTotal += entry.additions + entry.deletions;
    }
    const parsed = Date.parse(entry.date);
    if (!Number.isNaN(parsed) && now - parsed <= RECENT_WINDOW_MS) recentCount += 1;
  }

  return {
    totalCommits: entries.length,
    activeAuthors: authors.size,
    averageChangesPerCommit: sizedCount > 0 ? Math.round((sizedTotal / sizedCount) * 100) / 100 : null,
    recentChangeRate: entries.length > 0 ? Math.round((recentCount / entries.length) * 100) / 100 : 0,
  };
}

export async function fetchFileHistory(
  owner: string,
  repo: string,
  path: string,
  page: number,
  perPage: number,
  credential?: GithubCredential
): Promise<FileHistory> {
  const key = `${repoKey(owner, repo, credential)}::${path}::${page}::${perPage}`;
  const cached = fileHistoryCache.get(key);
  if (cached !== null) return cached;

  const repository = await fetchRepositoryInfo(owner, repo, credential);
  const octokit = resolveOctokit(credential);

  let response;
  try {
    response = await octokit.rest.repos.listCommits({
      owner: repository.owner,
      repo: repository.name,
      path,
      page,
      per_page: perPage,
    });
  } catch (error) {
    throw toAppError(error);
  }

  const entries: FileHistoryEntry[] = response.data.map((raw) => {
    const summary = toCommitSummary(raw as RawCommit);
    return {
      sha: summary.sha,
      shortSha: summary.shortSha,
      date: summary.date,
      message: summary.message,
      author: summary.author,
      // Deliberately omitted: see FileHistoryEntry's doc comment. Getting
      // real per-commit size here would cost one GitHub request per commit.
    };
  });

  const result: FileHistory = {
    repository,
    path,
    entries,
    pagination: { page, perPage, hasNextPage: hasNextPage(response.headers.link) },
    stats: computeFileEvolutionStats(entries),
  };

  fileHistoryCache.set(key, result);
  return result;
}

// ── history stats (hotspots + contributors) ────────────────────────────

/**
 * Hotspots and contributor activity both need per-file, per-commit diff
 * data that `listCommits` does not provide. This inspects each commit on the
 * requested page individually (`getCommit`, one call per commit), bounded by
 * `perPage` (itself capped at `env.history.maxHistoryCommits`) — a bounded,
 * user-triggered cost, not an unbounded N+1: it only runs when a caller asks
 * for hotspots or contributor stats, never as a side effect of loading the
 * plain commit list.
 */
export async function fetchHistoryStats(
  owner: string,
  repo: string,
  query: ValidatedHistoryQuery,
  credential?: GithubCredential
): Promise<HistoryStats> {
  const key = `${repoKey(owner, repo, credential)}::${JSON.stringify(query)}`;
  const cached = historyStatsCache.get(key);
  if (cached !== null) return cached;

  const repository = await fetchRepositoryInfo(owner, repo, credential);
  const octokit = resolveOctokit(credential);

  let listResponse;
  try {
    listResponse = await octokit.rest.repos.listCommits({
      owner: repository.owner,
      repo: repository.name,
      page: query.page,
      per_page: query.perPage,
      author: query.author,
      path: query.path,
      since: query.since,
      until: query.until,
    });
  } catch (error) {
    throw toAppError(error);
  }

  const hotspotByPath = new Map<string, ChangeHotspot>();
  const contributorByKey = new Map<string, ContributorStats>();
  let truncated = false;

  for (const raw of listResponse.data) {
    let detail;
    try {
      ({ data: detail } = await octokit.rest.repos.getCommit({
        owner: repository.owner,
        repo: repository.name,
        ref: raw.sha,
      }));
    } catch (error) {
      // One unreadable commit (rare: e.g. a commit removed between the list
      // and detail calls) must not fail the whole aggregate.
      const mapped = toCommitLookupError(error);
      if (mapped.statusCode === 404 || mapped.statusCode === 422) continue;
      throw mapped;
    }

    const summary = toCommitSummary(raw as RawCommit);
    const files = (detail.files ?? []) as RawFile[];
    if (files.length > env.history.maxCommitFiles) truncated = true;

    for (const file of files.slice(0, env.history.maxCommitFiles)) {
      const existing = hotspotByPath.get(file.filename);
      if (existing === undefined) {
        hotspotByPath.set(file.filename, {
          path: file.filename,
          commits: 1,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
        });
      } else {
        existing.commits += 1;
        existing.additions += file.additions ?? 0;
        existing.deletions += file.deletions ?? 0;
      }
    }

    const contributorKey = summary.author.login ?? (summary.author.email || summary.author.name);
    const contributorName = summary.author.login ?? (summary.author.name || summary.author.email);
    const existingContributor = contributorByKey.get(contributorKey);
    const additions = detail.stats?.additions ?? 0;
    const deletions = detail.stats?.deletions ?? 0;
    if (existingContributor === undefined) {
      contributorByKey.set(contributorKey, {
        name: contributorName,
        login: summary.author.login,
        commits: 1,
        filesChanged: files.length,
        additions,
        deletions,
      });
    } else {
      existingContributor.commits += 1;
      existingContributor.filesChanged += files.length;
      existingContributor.additions += additions;
      existingContributor.deletions += deletions;
    }
  }

  const result: HistoryStats = {
    repository,
    hotspots: [...hotspotByPath.values()].sort(
      (a, b) => b.commits - a.commits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    ),
    contributors: [...contributorByKey.values()].sort(
      (a, b) => b.commits - a.commits || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    ),
    commitsAnalyzed: listResponse.data.length,
    truncated,
  };

  historyStatsCache.set(key, result);
  return result;
}
