/**
 * Git history, evolution and impact-analysis DTOs — the contract between
 * backend and frontend (Phase 7).
 *
 * Plain data only: no Octokit response types, no credentials. Everything
 * here describes repository history as GitHub reports it; nothing is
 * executed, cloned, or run locally — every fact comes from the GitHub REST
 * API.
 */

export interface CommitAuthor {
  name: string;
  email: string;
  /** GitHub login, when the commit is linked to an account. */
  login: string | null;
  avatarUrl: string | null;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  author: CommitAuthor;
  committer: CommitAuthor;
  /** ISO 8601, from the commit's author date. */
  date: string;
  url: string;
}

export type ChangedFileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  previousPath: string | null;
  /** Whether GitHub supplied patch text — the patch itself is never returned. */
  patchAvailable: boolean;
}

export interface CommitStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface HistoryRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface HistoryPagination {
  page: number;
  perPage: number;
  hasNextPage: boolean;
}

export interface RepositoryHistory {
  repository: HistoryRepositoryInfo;
  commits: CommitSummary[];
  pagination: HistoryPagination;
}

export interface CommitDetail {
  commit: CommitSummary;
  stats: CommitStats;
  files: ChangedFile[];
  /** True when more files existed than the response includes. */
  filesTruncated: boolean;
}

export interface CommitComparison {
  repository: HistoryRepositoryInfo;
  base: CommitSummary;
  head: CommitSummary;
  stats: CommitStats;
  files: ChangedFile[];
  filesTruncated: boolean;
}

export interface FileHistoryEntry {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
  author: CommitAuthor;
  /**
   * Per-commit size for this file. `undefined` when it was not requested —
   * `listCommits` (the one call this endpoint makes) does not report it;
   * getting it would mean one additional GitHub request per commit.
   */
  additions?: number;
  deletions?: number;
}

export interface FileEvolutionStats {
  totalCommits: number;
  activeAuthors: number;
  /**
   * `null` when size data was not available for any commit in this history
   * (see `FileHistoryEntry.additions`) — never a fabricated average.
   */
  averageChangesPerCommit: number | null;
  /** Fraction (0–1) of the fetched commits dated within the last 90 days. */
  recentChangeRate: number;
}

export interface FileHistory {
  repository: HistoryRepositoryInfo;
  path: string;
  entries: FileHistoryEntry[];
  pagination: HistoryPagination;
  stats: FileEvolutionStats;
}

/**
 * Observed historical change frequency for one path — nothing more. Never a
 * prediction of bug-proneness or code quality.
 */
export interface ChangeHotspot {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
}

export interface ContributorStats {
  /** Display name: the GitHub login when known, otherwise the commit author name. */
  name: string;
  login: string | null;
  commits: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface HistoryStats {
  repository: HistoryRepositoryInfo;
  hotspots: ChangeHotspot[];
  contributors: ContributorStats[];
  /** Commits individually inspected to build these aggregates. */
  commitsAnalyzed: number;
  truncated: boolean;
}

/** How a file in an impact graph relates to the compared change. */
/**
 * `"unresolved"` is a changed file that the static dependency graph has no
 * node for at all (not a supported source extension, or removed and so
 * absent from the compared tree) — its dependents, if any, cannot be
 * statically determined, which is reported honestly rather than silently
 * treating the file as having no impact.
 */
export type ImpactRelationship = "changed" | "direct" | "transitive" | "unresolved";

export interface ImpactNode {
  id: string;
  path: string;
  relationship: ImpactRelationship;
  /** 0 for a changed file; 1 for a direct dependent; 2+ for transitive. */
  depth: number;
  changeStatus?: ChangedFileStatus;
}

/** `source` depends on (imports) `target` — the same direction Phase 4 uses. */
export interface ImpactEdge {
  source: string;
  target: string;
}

export type ImpactTruncationReason = "max_files" | "max_depth";

export interface ImpactStats {
  changedFiles: number;
  affectedFiles: number;
  maxDepth: number;
}

export interface ImpactFunctionInfo {
  id: string;
  file: string;
  name: string;
}

export interface ImpactFunctionAnalysis {
  available: boolean;
  /** Functions, in changed files, with at least one statically known caller. */
  changedFunctions: ImpactFunctionInfo[];
  /** Callers of those functions, statically reachable per Phase 6's call graph. */
  affectedFunctions: ImpactFunctionInfo[];
}

export interface ImpactAnalysis {
  repository: HistoryRepositoryInfo;
  comparison: { base: string; head: string };
  changedFiles: string[];
  affectedFiles: string[];
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  stats: ImpactStats;
  functionImpact: ImpactFunctionAnalysis;
  warnings: string[];
  truncated: boolean;
  truncationReason?: ImpactTruncationReason;
}

// ── request bodies ──────────────────────────────────────────────────────

export interface HistoryRequestBody {
  url?: unknown;
  page?: unknown;
  perPage?: unknown;
  author?: unknown;
  path?: unknown;
  since?: unknown;
  until?: unknown;
}

export interface CommitRequestBody {
  url?: unknown;
  sha?: unknown;
}

export interface CompareRequestBody {
  url?: unknown;
  base?: unknown;
  head?: unknown;
}

export interface FileHistoryRequestBody {
  url?: unknown;
  path?: unknown;
  page?: unknown;
  perPage?: unknown;
}

export interface ImpactRequestBody {
  url?: unknown;
  base?: unknown;
  head?: unknown;
  maxDepth?: unknown;
}

// ── responses ────────────────────────────────────────────────────────────

export interface HistoryResponse {
  success: true;
  data: RepositoryHistory;
}

export interface CommitResponse {
  success: true;
  data: CommitDetail;
}

export interface CompareResponse {
  success: true;
  data: CommitComparison;
}

export interface FileHistoryResponse {
  success: true;
  data: FileHistory;
}

export interface HistoryStatsResponse {
  success: true;
  data: HistoryStats;
}

export interface ImpactResponse {
  success: true;
  data: ImpactAnalysis;
}
