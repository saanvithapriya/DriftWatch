/**
 * Validation of backend responses before they reach the UI.
 *
 * Kept separate from `api.ts` so these pure functions can be unit-tested
 * without Vite's `import.meta.env`. A backend answering with the wrong shape
 * must surface as an ordinary error, never an uncaught TypeError that
 * unmounts the React tree.
 */
import type { CallGraphAnalysis, CallGraphEdge, CallGraphEntryPoint, CallGraphFunctionNode } from "../types/callGraph";
import type { DependencyAnalysis } from "../types/dependencies";
import type { RepositoryTree } from "../types/github";
import type {
  ChangeHotspot,
  ChangedFile,
  CommitAuthor,
  CommitComparison,
  CommitDetail,
  CommitSummary,
  ContributorStats,
  FileHistory,
  FileHistoryEntry,
  HistoryStats,
  ImpactAnalysis,
  ImpactEdge,
  ImpactFunctionInfo,
  ImpactNode,
  RepositoryHistory,
} from "../types/history";
import type {
  Workflow,
  WorkflowAnalysis,
  WorkflowJob,
  WorkflowStep,
  WorkflowTrigger,
} from "../types/workflows";
import type {
  SchemaAnalysis,
  SchemaField,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaIndex,
  SchemaModel,
  SchemaRelationship,
} from "../types/schema";

/** Reads the backend's `{ success: false, message }` shape, if present. */
export function readErrorMessage(payload: unknown): string | null {
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
export function parseRepositoryTree(payload: unknown): RepositoryTree | null {
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

/**
 * Validates a dependency analysis payload before it reaches the UI.
 *
 * Same reasoning as the repository tree: a backend answering with the wrong
 * shape must surface as an ordinary error, not an uncaught TypeError that
 * unmounts the React tree.
 */
export function parseDependencyAnalysis(payload: unknown): DependencyAnalysis | null {
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

  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;

  for (const node of data.nodes) {
    if (typeof node !== "object" || node === null) return null;
    const entry = node as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.path !== "string") return null;
    if (typeof entry.label !== "string") return null;
  }

  for (const edge of data.edges) {
    if (typeof edge !== "object" || edge === null) return null;
    const entry = edge as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.source !== "string" ||
      typeof entry.target !== "string"
    ) {
      return null;
    }
  }

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (typeof statsRecord.truncated !== "boolean") return null;
  for (const key of [
    "filesAnalyzed",
    "filesSkipped",
    "filesFailed",
    "dependenciesFound",
    "internalDependencies",
    "externalImports",
    "externalPackages",
    "unresolvedImports",
  ]) {
    if (typeof statsRecord[key] !== "number") return null;
  }

  return data as unknown as DependencyAnalysis;
}


/** Validates one workflow step, inventing nothing. */
function parseStep(value: unknown): WorkflowStep | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.hasWith !== "boolean" || typeof raw.hasEnv !== "boolean") return null;

  for (const key of ["id", "name", "uses", "run", "if"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") return null;
  }
  return raw as unknown as WorkflowStep;
}

function parseJob(value: unknown): WorkflowJob | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!Array.isArray(raw.needs) || raw.needs.some((n) => typeof n !== "string")) return null;
  if (typeof raw.stepCount !== "number" || typeof raw.stepsTruncated !== "boolean") return null;
  if (!Array.isArray(raw.steps)) return null;
  for (const step of raw.steps) {
    if (parseStep(step) === null) return null;
  }

  return raw as unknown as WorkflowJob;
}

function parseTrigger(value: unknown): WorkflowTrigger | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.event !== "string") return null;
  return raw as unknown as WorkflowTrigger;
}

function parseWorkflowEntry(value: unknown): Workflow | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.path !== "string" || typeof raw.name !== "string") return null;
  if (typeof raw.jobCount !== "number" || typeof raw.jobsTruncated !== "boolean") return null;
  if (raw.parseError !== undefined && typeof raw.parseError !== "string") return null;

  if (!Array.isArray(raw.triggers)) return null;
  for (const trigger of raw.triggers) {
    if (parseTrigger(trigger) === null) return null;
  }

  if (!Array.isArray(raw.jobs)) return null;
  for (const job of raw.jobs) {
    if (parseJob(job) === null) return null;
  }

  return raw as unknown as Workflow;
}

/**
 * Confirms a payload really is a `WorkflowAnalysis` before it reaches the UI.
 *
 * Same reasoning as the repository tree and dependency graph: a backend
 * answering with the wrong shape must surface as an ordinary error rather
 * than an uncaught TypeError that unmounts the React tree.
 */
export function parseWorkflowAnalysis(payload: unknown): WorkflowAnalysis | null {
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

  if (!Array.isArray(data.workflows)) return null;
  for (const workflow of data.workflows) {
    if (parseWorkflowEntry(workflow) === null) return null;
  }

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (typeof statsRecord.truncated !== "boolean") return null;
  for (const key of ["workflowsFound", "workflowsAnalyzed", "workflowsFailed"]) {
    if (typeof statsRecord[key] !== "number") return null;
  }

  return data as unknown as WorkflowAnalysis;
}

/** Validates one call graph function node, inventing nothing. */
function parseCallGraphNode(value: unknown): CallGraphFunctionNode | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.file !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.displayName !== "string" ||
    typeof raw.kind !== "string" ||
    typeof raw.exported !== "boolean" ||
    typeof raw.startLine !== "number" ||
    typeof raw.endLine !== "number"
  ) {
    return null;
  }
  return raw as unknown as CallGraphFunctionNode;
}

function parseCallGraphEdge(value: unknown): CallGraphEdge | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.source !== "string" ||
    typeof raw.target !== "string" ||
    typeof raw.callExpression !== "string" ||
    typeof raw.line !== "number" ||
    typeof raw.callCount !== "number"
  ) {
    return null;
  }
  return raw as unknown as CallGraphEdge;
}

function parseCallGraphEntryPointEntry(value: unknown): CallGraphEntryPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.file !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.startLine !== "number" ||
    typeof raw.endLine !== "number"
  ) {
    return null;
  }
  return raw as unknown as CallGraphEntryPoint;
}

/**
 * Confirms a payload really is a `CallGraphAnalysis` before it reaches the
 * UI. Same reasoning as the repository tree, dependency graph and workflow
 * analysis: a backend answering with the wrong shape must surface as an
 * ordinary error rather than an uncaught TypeError that unmounts the React
 * tree.
 */
export function parseCallGraphAnalysis(payload: unknown): CallGraphAnalysis | null {
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

  if (data.entryPoint !== null) {
    if (typeof data.entryPoint !== "object") return null;
    const entry = data.entryPoint as Record<string, unknown>;
    if (
      typeof entry.functionId !== "string" ||
      typeof entry.file !== "string" ||
      typeof entry.name !== "string"
    ) {
      return null;
    }
  }

  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
  if (!Array.isArray(data.availableEntryPoints)) return null;

  for (const node of data.nodes) {
    if (parseCallGraphNode(node) === null) return null;
  }
  for (const edge of data.edges) {
    if (parseCallGraphEdge(edge) === null) return null;
  }
  for (const entryPoint of data.availableEntryPoints) {
    if (parseCallGraphEntryPointEntry(entryPoint) === null) return null;
  }

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  for (const key of [
    "functionsDiscovered",
    "functionsReachable",
    "edges",
    "unresolvedCalls",
    "externalCalls",
    "maxDepth",
  ]) {
    if (typeof statsRecord[key] !== "number") return null;
  }

  if (typeof data.truncated !== "boolean") return null;
  if (data.truncationReason !== undefined && typeof data.truncationReason !== "string") {
    return null;
  }

  return data as unknown as CallGraphAnalysis;
}

// ── git history (Phase 7) ────────────────────────────────────────────────

/** Shared by every Phase 7 DTO: {owner, name, defaultBranch}. */
function parseHistoryRepository(value: unknown): { owner: string; name: string; defaultBranch: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const repo = value as Record<string, unknown>;
  if (
    typeof repo.owner !== "string" ||
    typeof repo.name !== "string" ||
    typeof repo.defaultBranch !== "string"
  ) {
    return null;
  }
  return { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch };
}

function parseCommitAuthor(value: unknown): CommitAuthor | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string" || typeof raw.email !== "string") return null;
  if (raw.login !== null && typeof raw.login !== "string") return null;
  if (raw.avatarUrl !== null && typeof raw.avatarUrl !== "string") return null;
  return raw as unknown as CommitAuthor;
}

function parseCommitSummary(value: unknown): CommitSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.sha !== "string" ||
    typeof raw.shortSha !== "string" ||
    typeof raw.message !== "string" ||
    typeof raw.date !== "string" ||
    typeof raw.url !== "string"
  ) {
    return null;
  }
  if (parseCommitAuthor(raw.author) === null) return null;
  if (parseCommitAuthor(raw.committer) === null) return null;
  return raw as unknown as CommitSummary;
}

const VALID_CHANGED_FILE_STATUSES = new Set([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

function parseChangedFile(value: unknown): ChangedFile | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== "string" || typeof raw.status !== "string") return null;
  if (!VALID_CHANGED_FILE_STATUSES.has(raw.status)) return null;
  if (
    typeof raw.additions !== "number" ||
    typeof raw.deletions !== "number" ||
    typeof raw.changes !== "number"
  ) {
    return null;
  }
  if (raw.previousPath !== null && typeof raw.previousPath !== "string") return null;
  if (typeof raw.patchAvailable !== "boolean") return null;
  return raw as unknown as ChangedFile;
}

function parsePagination(value: unknown): { page: number; perPage: number; hasNextPage: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.page !== "number" ||
    typeof raw.perPage !== "number" ||
    typeof raw.hasNextPage !== "boolean"
  ) {
    return null;
  }
  return raw as unknown as { page: number; perPage: number; hasNextPage: boolean };
}

/** Confirms a payload is a `RepositoryHistory` before it reaches the UI. */
export function parseRepositoryHistory(payload: unknown): RepositoryHistory | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;
  if (!Array.isArray(data.commits)) return null;
  for (const commit of data.commits) {
    if (parseCommitSummary(commit) === null) return null;
  }
  if (parsePagination(data.pagination) === null) return null;

  return data as unknown as RepositoryHistory;
}

/** Confirms a payload is a `CommitDetail` before it reaches the UI. */
export function parseCommitDetail(payload: unknown): CommitDetail | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseCommitSummary(data.commit) === null) return null;

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (
    typeof statsRecord.filesChanged !== "number" ||
    typeof statsRecord.additions !== "number" ||
    typeof statsRecord.deletions !== "number"
  ) {
    return null;
  }

  if (!Array.isArray(data.files)) return null;
  for (const file of data.files) {
    if (parseChangedFile(file) === null) return null;
  }
  if (typeof data.filesTruncated !== "boolean") return null;

  return data as unknown as CommitDetail;
}

/** Confirms a payload is a `CommitComparison` before it reaches the UI. */
export function parseCommitComparison(payload: unknown): CommitComparison | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;
  if (parseCommitSummary(data.base) === null) return null;
  if (parseCommitSummary(data.head) === null) return null;

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (
    typeof statsRecord.filesChanged !== "number" ||
    typeof statsRecord.additions !== "number" ||
    typeof statsRecord.deletions !== "number"
  ) {
    return null;
  }

  if (!Array.isArray(data.files)) return null;
  for (const file of data.files) {
    if (parseChangedFile(file) === null) return null;
  }
  if (typeof data.filesTruncated !== "boolean") return null;

  return data as unknown as CommitComparison;
}

function parseFileHistoryEntry(value: unknown): FileHistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.sha !== "string" ||
    typeof raw.shortSha !== "string" ||
    typeof raw.date !== "string" ||
    typeof raw.message !== "string"
  ) {
    return null;
  }
  if (parseCommitAuthor(raw.author) === null) return null;
  if (raw.additions !== undefined && typeof raw.additions !== "number") return null;
  if (raw.deletions !== undefined && typeof raw.deletions !== "number") return null;
  return raw as unknown as FileHistoryEntry;
}

/** Confirms a payload is a `FileHistory` before it reaches the UI. */
export function parseFileHistory(payload: unknown): FileHistory | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;
  if (typeof data.path !== "string") return null;

  if (!Array.isArray(data.entries)) return null;
  for (const entry of data.entries) {
    if (parseFileHistoryEntry(entry) === null) return null;
  }
  if (parsePagination(data.pagination) === null) return null;

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (
    typeof statsRecord.totalCommits !== "number" ||
    typeof statsRecord.activeAuthors !== "number" ||
    typeof statsRecord.recentChangeRate !== "number"
  ) {
    return null;
  }
  if (statsRecord.averageChangesPerCommit !== null && typeof statsRecord.averageChangesPerCommit !== "number") {
    return null;
  }

  return data as unknown as FileHistory;
}

function parseChangeHotspot(value: unknown): ChangeHotspot | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.path !== "string" ||
    typeof raw.commits !== "number" ||
    typeof raw.additions !== "number" ||
    typeof raw.deletions !== "number"
  ) {
    return null;
  }
  return raw as unknown as ChangeHotspot;
}

function parseContributorStats(value: unknown): ContributorStats | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.name !== "string" ||
    typeof raw.commits !== "number" ||
    typeof raw.filesChanged !== "number" ||
    typeof raw.additions !== "number" ||
    typeof raw.deletions !== "number"
  ) {
    return null;
  }
  if (raw.login !== null && typeof raw.login !== "string") return null;
  return raw as unknown as ContributorStats;
}

/** Confirms a payload is a `HistoryStats` before it reaches the UI. */
export function parseHistoryStats(payload: unknown): HistoryStats | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;

  if (!Array.isArray(data.hotspots)) return null;
  for (const hotspot of data.hotspots) {
    if (parseChangeHotspot(hotspot) === null) return null;
  }

  if (!Array.isArray(data.contributors)) return null;
  for (const contributor of data.contributors) {
    if (parseContributorStats(contributor) === null) return null;
  }

  if (typeof data.commitsAnalyzed !== "number") return null;
  if (typeof data.truncated !== "boolean") return null;

  return data as unknown as HistoryStats;
}

const VALID_IMPACT_RELATIONSHIPS = new Set(["changed", "direct", "transitive", "unresolved"]);

function parseImpactNode(value: unknown): ImpactNode | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.path !== "string") return null;
  if (typeof raw.relationship !== "string" || !VALID_IMPACT_RELATIONSHIPS.has(raw.relationship)) return null;
  if (typeof raw.depth !== "number") return null;
  if (raw.changeStatus !== undefined && typeof raw.changeStatus !== "string") return null;
  return raw as unknown as ImpactNode;
}

function parseImpactEdge(value: unknown): ImpactEdge | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.source !== "string" || typeof raw.target !== "string") return null;
  return raw as unknown as ImpactEdge;
}

function parseImpactFunctionInfo(value: unknown): ImpactFunctionInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.file !== "string" || typeof raw.name !== "string") {
    return null;
  }
  return raw as unknown as ImpactFunctionInfo;
}

/** Confirms a payload is an `ImpactAnalysis` before it reaches the UI. */
export function parseImpactAnalysis(payload: unknown): ImpactAnalysis | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;

  const comparison = data.comparison;
  if (typeof comparison !== "object" || comparison === null) return null;
  const comparisonRecord = comparison as Record<string, unknown>;
  if (typeof comparisonRecord.base !== "string" || typeof comparisonRecord.head !== "string") {
    return null;
  }

  if (!Array.isArray(data.changedFiles) || data.changedFiles.some((p) => typeof p !== "string")) {
    return null;
  }
  if (!Array.isArray(data.affectedFiles) || data.affectedFiles.some((p) => typeof p !== "string")) {
    return null;
  }

  if (!Array.isArray(data.nodes)) return null;
  for (const node of data.nodes) {
    if (parseImpactNode(node) === null) return null;
  }
  if (!Array.isArray(data.edges)) return null;
  for (const edge of data.edges) {
    if (parseImpactEdge(edge) === null) return null;
  }

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  if (
    typeof statsRecord.changedFiles !== "number" ||
    typeof statsRecord.affectedFiles !== "number" ||
    typeof statsRecord.maxDepth !== "number"
  ) {
    return null;
  }

  const functionImpact = data.functionImpact;
  if (typeof functionImpact !== "object" || functionImpact === null) return null;
  const functionImpactRecord = functionImpact as Record<string, unknown>;
  if (typeof functionImpactRecord.available !== "boolean") return null;
  if (!Array.isArray(functionImpactRecord.changedFunctions)) return null;
  for (const fn of functionImpactRecord.changedFunctions) {
    if (parseImpactFunctionInfo(fn) === null) return null;
  }
  if (!Array.isArray(functionImpactRecord.affectedFunctions)) return null;
  for (const fn of functionImpactRecord.affectedFunctions) {
    if (parseImpactFunctionInfo(fn) === null) return null;
  }

  if (!Array.isArray(data.warnings) || data.warnings.some((w) => typeof w !== "string")) {
    return null;
  }
  if (typeof data.truncated !== "boolean") return null;
  if (data.truncationReason !== undefined && typeof data.truncationReason !== "string") return null;

  return data as unknown as ImpactAnalysis;
}

// ── database schema (Phase 8) ────────────────────────────────────────────

const VALID_SCHEMA_SOURCE_TYPES = new Set(["prisma", "sql", "mongoose"]);
const VALID_CARDINALITIES = new Set(["1:1", "1:N", "N:1", "N:M", "unknown"]);

function parseSchemaField(value: unknown): SchemaField | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.type !== "string") {
    return null;
  }
  if (
    typeof raw.nullable !== "boolean" ||
    typeof raw.primaryKey !== "boolean" ||
    typeof raw.unique !== "boolean" ||
    typeof raw.array !== "boolean"
  ) {
    return null;
  }
  if (raw.required !== undefined && typeof raw.required !== "boolean") return null;
  if (raw.defaultValue !== undefined && typeof raw.defaultValue !== "string") return null;
  if (raw.references !== undefined) {
    if (typeof raw.references !== "object" || raw.references === null) return null;
    const ref = raw.references as Record<string, unknown>;
    if (typeof ref.model !== "string") return null;
    if (ref.field !== undefined && typeof ref.field !== "string") return null;
  }
  return raw as unknown as SchemaField;
}

function parseSchemaIndex(value: unknown): SchemaIndex | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.fields) || raw.fields.some((f) => typeof f !== "string")) return null;
  if (typeof raw.unique !== "boolean") return null;
  if (raw.name !== undefined && typeof raw.name !== "string") return null;
  return raw as unknown as SchemaIndex;
}

function parseSchemaModel(value: unknown): SchemaModel | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.sourcePath !== "string") {
    return null;
  }
  if (typeof raw.sourceType !== "string" || !VALID_SCHEMA_SOURCE_TYPES.has(raw.sourceType)) return null;
  if (!Array.isArray(raw.fields)) return null;
  for (const field of raw.fields) {
    if (parseSchemaField(field) === null) return null;
  }
  if (!Array.isArray(raw.indexes)) return null;
  for (const index of raw.indexes) {
    if (parseSchemaIndex(index) === null) return null;
  }
  return raw as unknown as SchemaModel;
}

function parseSchemaRelationship(value: unknown): SchemaRelationship | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.sourceModel !== "string" ||
    typeof raw.targetModel !== "string"
  ) {
    return null;
  }
  if (typeof raw.cardinality !== "string" || !VALID_CARDINALITIES.has(raw.cardinality)) return null;
  if (typeof raw.inferred !== "boolean") return null;
  for (const key of ["sourceField", "targetField", "relationName"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") return null;
  }
  return raw as unknown as SchemaRelationship;
}

function parseSchemaGraphNode(value: unknown): SchemaGraphNode | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string") return null;
  if (parseSchemaModel(raw.model) === null) return null;
  return raw as unknown as SchemaGraphNode;
}

function parseSchemaGraphEdge(value: unknown): SchemaGraphEdge | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.source !== "string" || typeof raw.target !== "string") {
    return null;
  }
  if (parseSchemaRelationship(raw.relationship) === null) return null;
  return raw as unknown as SchemaGraphEdge;
}

/**
 * Confirms a payload is a `SchemaAnalysis` before it reaches the UI. Same
 * reasoning as every other endpoint: a backend answering with the wrong
 * shape must surface as an ordinary error, never an uncaught TypeError that
 * unmounts the React tree.
 */
export function parseSchemaAnalysis(payload: unknown): SchemaAnalysis | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;

  if (parseHistoryRepository(data.repository) === null) return null;

  if (!Array.isArray(data.providers) || data.providers.some((p) => !VALID_SCHEMA_SOURCE_TYPES.has(p as string))) {
    return null;
  }

  if (!Array.isArray(data.schemas)) return null;
  for (const model of data.schemas) {
    if (parseSchemaModel(model) === null) return null;
  }
  if (!Array.isArray(data.relationships)) return null;
  for (const rel of data.relationships) {
    if (parseSchemaRelationship(rel) === null) return null;
  }
  if (!Array.isArray(data.nodes)) return null;
  for (const node of data.nodes) {
    if (parseSchemaGraphNode(node) === null) return null;
  }
  if (!Array.isArray(data.edges)) return null;
  for (const edge of data.edges) {
    if (parseSchemaGraphEdge(edge) === null) return null;
  }

  const stats = data.stats;
  if (typeof stats !== "object" || stats === null) return null;
  const statsRecord = stats as Record<string, unknown>;
  for (const key of ["models", "fields", "relationships", "primaryKeys", "foreignKeys", "indexes"]) {
    if (typeof statsRecord[key] !== "number") return null;
  }
  if (typeof statsRecord.byProvider !== "object" || statsRecord.byProvider === null) return null;

  if (!Array.isArray(data.warnings) || data.warnings.some((w) => typeof w !== "string")) return null;
  if (typeof data.truncated !== "boolean") return null;
  if (data.truncationReason !== undefined && typeof data.truncationReason !== "string") return null;

  return data as unknown as SchemaAnalysis;
}
