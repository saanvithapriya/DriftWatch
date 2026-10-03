/**
 * Git history, evolution and impact-analysis DTOs, mirroring the backend
 * contract (Phase 7).
 *
 * Declared separately from the backend's copy on purpose: the frontend
 * consumes the API shape, not backend implementation types. Commit messages,
 * author names and file paths are repository-controlled strings — rendered
 * as plain React text everywhere, never through `dangerouslySetInnerHTML`.
 */

export interface CommitAuthor {
  name: string;
  email: string;
  login: string | null;
  avatarUrl: string | null;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  author: CommitAuthor;
  committer: CommitAuthor;
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
  additions?: number;
  deletions?: number;
}

export interface FileEvolutionStats {
  totalCommits: number;
  activeAuthors: number;
  averageChangesPerCommit: number | null;
  recentChangeRate: number;
}

export interface FileHistory {
  repository: HistoryRepositoryInfo;
  path: string;
  entries: FileHistoryEntry[];
  pagination: HistoryPagination;
  stats: FileEvolutionStats;
}

export interface ChangeHotspot {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
}

export interface ContributorStats {
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
  commitsAnalyzed: number;
  truncated: boolean;
}

export type ImpactRelationship = "changed" | "direct" | "transitive" | "unresolved";

export interface ImpactNode {
  id: string;
  path: string;
  relationship: ImpactRelationship;
  depth: number;
  changeStatus?: ChangedFileStatus;
}

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
  changedFunctions: ImpactFunctionInfo[];
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
