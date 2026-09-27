/**
 * Validation of backend responses before they reach the UI.
 *
 * Kept separate from `api.ts` so these pure functions can be unit-tested
 * without Vite's `import.meta.env`. A backend answering with the wrong shape
 * must surface as an ordinary error, never an uncaught TypeError that
 * unmounts the React tree.
 */
import type { DependencyAnalysis } from "../types/dependencies";
import type { RepositoryTree } from "../types/github";
import type {
  Workflow,
  WorkflowAnalysis,
  WorkflowJob,
  WorkflowStep,
  WorkflowTrigger,
} from "../types/workflows";

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
