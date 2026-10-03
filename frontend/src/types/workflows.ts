/**
 * Normalized GitHub Actions workflow DTO — the contract between backend and
 * frontend.
 *
 * Declared separately from the backend's copy on purpose: the frontend
 * consumes the API shape, not backend implementation types.
 *
 * Workflow content is untrusted data that is displayed, never executed.
 */

export interface WorkflowTrigger {
  /** Event name exactly as written, e.g. `push`, `schedule`. */
  event: string;
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  paths?: string[];
  /** Activity types, e.g. `opened`, `synchronize`. */
  types?: string[];
  /** Cron expressions for `schedule`. */
  cron?: string[];
}

export interface WorkflowStep {
  id?: string;
  name?: string;
  /** Action reference, e.g. `actions/checkout@v4`. Never resolved or run. */
  uses?: string;
  /** Shell text, stored verbatim for display. Never executed. */
  run?: string;
  /** Condition expression, stored as text. Never evaluated. */
  if?: string;
  /**
   * Only the presence of `with:` / `env:` is recorded. Their values are
   * deliberately not carried, because they routinely hold secret references.
   */
  hasWith: boolean;
  hasEnv: boolean;
}

export interface WorkflowMatrixDimension {
  key: string;
  values: string[];
}

export interface WorkflowMatrix {
  dimensions: WorkflowMatrixDimension[];
  hasInclude: boolean;
  hasExclude: boolean;
}

export interface WorkflowJob {
  /** Key under `jobs:`. */
  id: string;
  /** `name:` when present, otherwise the job id. */
  name: string;
  /** Explicit `needs` only — never inferred from document order. */
  needs: string[];
  runsOn?: string;
  if?: string;
  environment?: string;
  timeoutMinutes?: number;
  continueOnError?: boolean;
  /** Reusable workflow reference for a `uses:` job. Never followed. */
  uses?: string;
  matrix?: WorkflowMatrix;
  steps: WorkflowStep[];
  /** Steps before any limit was applied. */
  stepCount: number;
  stepsTruncated: boolean;
}

export interface Workflow {
  /** Repository path, e.g. `.github/workflows/ci.yml`. */
  path: string;
  name: string;
  triggers: WorkflowTrigger[];
  jobs: WorkflowJob[];
  /** Jobs before any limit was applied. */
  jobCount: number;
  jobsTruncated: boolean;
  /** Present when the file could not be parsed; jobs will be empty. */
  parseError?: string;
}

export interface WorkflowStats {
  workflowsFound: number;
  workflowsAnalyzed: number;
  workflowsFailed: number;
  /** True when a limit reduced the analysis anywhere. */
  truncated: boolean;
}

export interface WorkflowRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface WorkflowAnalysis {
  repository: WorkflowRepositoryInfo;
  workflows: Workflow[];
  stats: WorkflowStats;
}
