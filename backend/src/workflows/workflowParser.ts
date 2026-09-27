import { parse as parseYaml } from "yaml";
import type {
  Workflow,
  WorkflowJob,
  WorkflowMatrix,
  WorkflowStep,
  WorkflowTrigger,
} from "../types/workflows.js";

/**
 * GitHub Actions workflow parsing.
 *
 * Pure functions over text. Workflow YAML is untrusted input: it is parsed and
 * described, never executed, never evaluated, and no expression or secret
 * reference is ever resolved. Nothing here reads a request, a session or a
 * credential.
 *
 * The `yaml` package parses as YAML 1.2, where `on` stays the string key
 * `"on"`. Under YAML 1.1 it would be coerced to boolean `true`, which would
 * silently lose every workflow's triggers — there is a test for exactly this.
 */

export interface WorkflowLimits {
  maxJobsPerWorkflow: number;
  maxStepsPerJob: number;
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxJobsPerWorkflow: 100,
  maxStepsPerJob: 100,
};

/** Long shell scripts are truncated so one step cannot bloat the response. */
const MAX_TEXT_LENGTH = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Renders a scalar for display; anything structural becomes null. */
function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function clampText(value: string): string {
  return value.length <= MAX_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_TEXT_LENGTH)}\n… (truncated)`;
}

/** Normalizes a scalar-or-list field into a list of display strings. */
function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    const items = value.map(scalarText).filter((v): v is string => v !== null);
    return items.length > 0 ? items : undefined;
  }

  const single = scalarText(value);
  return single === null ? undefined : [single];
}

/**
 * Derives a display name from a workflow filename.
 *
 * `ci.yml` -> `CI`, `release-please.yml` -> `Release Please`. Short words are
 * uppercased because they are nearly always acronyms in this context.
 */
export function deriveWorkflowName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.ya?ml$/i, "");
  const words = base.split(/[-_.\s]+/).filter((w) => w !== "");
  if (words.length === 0) return base;

  return words
    .map((word) =>
      word.length <= 3
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/**
 * Normalizes the `on:` section into a sorted list of triggers.
 *
 * Handles all three shapes GitHub accepts: a scalar (`on: push`), a list
 * (`on: [push, pull_request]`) and a map (`on: { push: { branches: [...] } }`).
 */
export function normalizeTriggers(on: unknown): WorkflowTrigger[] {
  const triggers: WorkflowTrigger[] = [];

  const addSimple = (event: string): void => {
    triggers.push({ event });
  };

  if (typeof on === "string") {
    addSimple(on);
  } else if (Array.isArray(on)) {
    for (const item of on) {
      const event = scalarText(item);
      if (event !== null) addSimple(event);
    }
  } else if (isRecord(on)) {
    for (const [event, config] of Object.entries(on)) {
      const trigger: WorkflowTrigger = { event };

      if (isRecord(config)) {
        trigger.branches = stringList(config.branches);
        trigger.branchesIgnore = stringList(config["branches-ignore"]);
        trigger.tags = stringList(config.tags);
        trigger.paths = stringList(config.paths);
        trigger.types = stringList(config.types);
      } else if (Array.isArray(config) && event === "schedule") {
        const cron = config
          .map((entry) => (isRecord(entry) ? scalarText(entry.cron) : null))
          .filter((v): v is string => v !== null);
        if (cron.length > 0) trigger.cron = cron;
      }

      triggers.push(trigger);
    }
  }

  // Sorted so the same workflow always normalizes identically.
  return triggers.sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
}

/** Normalizes `needs:` from either a scalar or a list. */
export function normalizeNeeds(needs: unknown): string[] {
  const list = stringList(needs) ?? [];
  // Deduplicated and sorted: a repeated dependency is still one edge.
  return [...new Set(list)].sort();
}

function normalizeMatrix(strategy: unknown): WorkflowMatrix | undefined {
  if (!isRecord(strategy)) return undefined;
  const matrix = strategy.matrix;
  if (!isRecord(matrix)) return undefined;

  const dimensions: WorkflowMatrix["dimensions"] = [];
  for (const [key, value] of Object.entries(matrix)) {
    if (key === "include" || key === "exclude") continue;

    // Values are described, never expanded into combinations.
    const values = Array.isArray(value)
      ? value.map((v) => scalarText(v) ?? "…").slice(0, 20)
      : [scalarText(value) ?? "…"];
    dimensions.push({ key, values });
  }

  dimensions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    dimensions,
    hasInclude: Array.isArray(matrix.include),
    hasExclude: Array.isArray(matrix.exclude),
  };
}

function normalizeStep(raw: unknown): WorkflowStep {
  if (!isRecord(raw)) {
    return { hasWith: false, hasEnv: false };
  }

  const step: WorkflowStep = {
    hasWith: isRecord(raw.with),
    hasEnv: isRecord(raw.env),
  };

  const id = scalarText(raw.id);
  if (id !== null) step.id = id;

  const name = scalarText(raw.name);
  if (name !== null) step.name = name;

  const uses = scalarText(raw.uses);
  if (uses !== null) step.uses = uses;

  // Stored verbatim as text for display. Never executed.
  const run = scalarText(raw.run);
  if (run !== null) step.run = clampText(run);

  const condition = scalarText(raw.if);
  if (condition !== null) step.if = clampText(condition);

  return step;
}

function normalizeJob(
  id: string,
  raw: unknown,
  limits: WorkflowLimits
): WorkflowJob {
  const source = isRecord(raw) ? raw : {};

  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const stepCount = rawSteps.length;
  const stepsTruncated = stepCount > limits.maxStepsPerJob;
  // Step order is semantically meaningful, so it is preserved exactly.
  const steps = rawSteps
    .slice(0, limits.maxStepsPerJob)
    .map((step) => normalizeStep(step));

  const job: WorkflowJob = {
    id,
    name: scalarText(source.name) ?? id,
    needs: normalizeNeeds(source.needs),
    steps,
    stepCount,
    stepsTruncated,
  };

  const runsOn = source["runs-on"];
  const runsOnText =
    scalarText(runsOn) ??
    (Array.isArray(runsOn)
      ? runsOn.map((v) => scalarText(v) ?? "").filter((v) => v !== "").join(", ")
      : isRecord(runsOn)
        ? (stringList(runsOn.labels) ?? []).join(", ") || null
        : null);
  if (runsOnText !== null && runsOnText !== "") job.runsOn = runsOnText;

  const condition = scalarText(source.if);
  if (condition !== null) job.if = clampText(condition);

  const environment = isRecord(source.environment)
    ? scalarText(source.environment.name)
    : scalarText(source.environment);
  if (environment !== null) job.environment = environment;

  const timeout = source["timeout-minutes"];
  if (typeof timeout === "number") job.timeoutMinutes = timeout;

  const continueOnError = source["continue-on-error"];
  if (typeof continueOnError === "boolean") job.continueOnError = continueOnError;

  // A reusable-workflow job. Recorded as metadata; never followed or run.
  const uses = scalarText(source.uses);
  if (uses !== null) job.uses = uses;

  const matrix = normalizeMatrix(source.strategy);
  if (matrix !== undefined && matrix.dimensions.length > 0) job.matrix = matrix;

  return job;
}

/**
 * Parses one workflow file into the normalized model.
 *
 * Never throws: a file that cannot be parsed comes back with `parseError` set
 * and no jobs, so one malformed workflow cannot fail the whole analysis.
 */
export function parseWorkflow(
  path: string,
  contents: string,
  limits: WorkflowLimits = DEFAULT_WORKFLOW_LIMITS
): Workflow {
  const fallbackName = deriveWorkflowName(path);

  let document: unknown;
  try {
    document = parseYaml(contents);
  } catch (error) {
    return {
      path,
      name: fallbackName,
      triggers: [],
      jobs: [],
      jobCount: 0,
      jobsTruncated: false,
      // The parser's own message is useful ("Tabs are not allowed…") and
      // contains only the file's own content, never anything internal.
      parseError:
        error instanceof Error
          ? error.message.split("\n")[0].slice(0, 200)
          : "Invalid YAML",
    };
  }

  if (!isRecord(document)) {
    return {
      path,
      name: fallbackName,
      triggers: [],
      jobs: [],
      jobCount: 0,
      jobsTruncated: false,
      parseError:
        document === null
          ? "Workflow file is empty"
          : "Workflow file is not a YAML mapping",
    };
  }

  const name = scalarText(document.name) ?? fallbackName;
  const triggers = normalizeTriggers(document.on);

  const rawJobs = isRecord(document.jobs) ? document.jobs : {};
  const jobIds = Object.keys(rawJobs).sort();
  const jobCount = jobIds.length;
  const jobsTruncated = jobCount > limits.maxJobsPerWorkflow;

  const jobs = jobIds
    .slice(0, limits.maxJobsPerWorkflow)
    .map((id) => normalizeJob(id, rawJobs[id], limits));

  return { path, name, triggers, jobs, jobCount, jobsTruncated };
}

/** True for `.github/workflows/*.yml` and `*.yaml`, and nothing else. */
export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}
