/**
 * Tests for backend-response validation.
 *
 * A backend answering `success: true` with the wrong shape must produce an
 * ordinary error, never propagate `undefined` into rendering code. These
 * hammer the validators with malformed payloads.
 *
 * Run with:  npx tsx src/services/responseContract.test.ts
 */
import { assert, assertEqual, report, test } from "../utils/testHarness";
import {
  parseCallGraphAnalysis,
  parseCommitComparison,
  parseCommitDetail,
  parseDependencyAnalysis,
  parseFileHistory,
  parseHistoryStats,
  parseImpactAnalysis,
  parseRepositoryHistory,
  parseRepositoryTree,
  parseSchemaAnalysis,
  parseWorkflowAnalysis,
  readErrorMessage,
} from "./responseContract";

const REPO = { owner: "o", name: "r", defaultBranch: "main" };

// ── error messages ───────────────────────────────────────────────────────

test("an error message is read from the standard envelope", () => {
  assertEqual(readErrorMessage({ message: "boom" }), "boom", "read");
});

test("a missing or unusable message yields null", () => {
  for (const payload of [null, undefined, {}, { message: "" }, { message: 1 }, "text", 42, []]) {
    assertEqual(readErrorMessage(payload), null, `null for ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

// ── repository tree ──────────────────────────────────────────────────────

test("a well-formed repository tree is accepted", () => {
  const payload = {
    repository: REPO,
    tree: [
      { path: "a.ts", type: "file" },
      { path: "src", type: "directory" },
    ],
    truncated: false,
  };
  assert(parseRepositoryTree(payload) !== null, "accepted");
});

test("an empty tree is valid", () => {
  assert(
    parseRepositoryTree({ repository: REPO, tree: [], truncated: false }) !== null,
    "accepted"
  );
});

test("malformed repository trees are all rejected", () => {
  const bad: unknown[] = [
    null,
    undefined,
    "string",
    42,
    [],
    {},
    { repository: REPO },
    { repository: REPO, tree: [] },
    { tree: [], truncated: false },
    { repository: null, tree: [], truncated: false },
    { repository: "x", tree: [], truncated: false },
    { repository: { owner: "o" }, tree: [], truncated: false },
    { repository: { owner: 1, name: "r", defaultBranch: "m" }, tree: [], truncated: false },
    { repository: REPO, tree: "nope", truncated: false },
    { repository: REPO, tree: {}, truncated: false },
    { repository: REPO, tree: [], truncated: "no" },
    { repository: REPO, tree: [null], truncated: false },
    { repository: REPO, tree: ["a.ts"], truncated: false },
    { repository: REPO, tree: [{ type: "file" }], truncated: false },
    { repository: REPO, tree: [{ path: 1, type: "file" }], truncated: false },
    { repository: REPO, tree: [{ path: "a", type: "symlink" }], truncated: false },
    { repository: REPO, tree: [{ path: "a" }], truncated: false },
  ];
  for (const payload of bad) {
    assertEqual(parseRepositoryTree(payload), null, `rejected: ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

test("one malformed node rejects the whole tree rather than rendering partly", () => {
  const payload = {
    repository: REPO,
    tree: [{ path: "ok.ts", type: "file" }, { path: 5, type: "file" }],
    truncated: false,
  };
  assertEqual(parseRepositoryTree(payload), null, "rejected");
});

// ── dependency analysis ──────────────────────────────────────────────────

const STATS = {
  filesAnalyzed: 1,
  filesSkipped: 0,
  filesFailed: 0,
  dependenciesFound: 1,
  internalDependencies: 1,
  externalImports: 0,
  externalPackages: 0,
  unresolvedImports: 0,
  truncated: false,
};

test("a well-formed dependency analysis is accepted", () => {
  const payload = {
    repository: REPO,
    nodes: [{ id: "a.ts", path: "a.ts", label: "a.ts", type: "file" }],
    edges: [{ id: "a.ts->b.ts", source: "a.ts", target: "b.ts", type: "internal" }],
    stats: STATS,
  };
  assert(parseDependencyAnalysis(payload) !== null, "accepted");
});

test("an empty graph is valid", () => {
  assert(
    parseDependencyAnalysis({ repository: REPO, nodes: [], edges: [], stats: STATS }) !== null,
    "accepted"
  );
});

test("malformed dependency analyses are all rejected", () => {
  const node = { id: "a.ts", path: "a.ts", label: "a.ts", type: "file" };
  const edge = { id: "e", source: "a.ts", target: "b.ts", type: "internal" };
  const bad: unknown[] = [
    null,
    undefined,
    "string",
    [],
    {},
    { repository: REPO, nodes: [], edges: [] },
    { repository: REPO, nodes: [], stats: STATS },
    { repository: REPO, edges: [], stats: STATS },
    { nodes: [], edges: [], stats: STATS },
    { repository: REPO, nodes: "no", edges: [], stats: STATS },
    { repository: REPO, nodes: [], edges: "no", stats: STATS },
    { repository: REPO, nodes: [], edges: [], stats: null },
    { repository: REPO, nodes: [], edges: [], stats: "no" },
    { repository: REPO, nodes: [null], edges: [], stats: STATS },
    { repository: REPO, nodes: [{ path: "a", label: "a" }], edges: [], stats: STATS },
    { repository: REPO, nodes: [{ id: 1, path: "a", label: "a" }], edges: [], stats: STATS },
    { repository: REPO, nodes: [{ id: "a", path: "a" }], edges: [], stats: STATS },
    { repository: REPO, nodes: [node], edges: [{ id: "e", source: "a" }], stats: STATS },
    { repository: REPO, nodes: [node], edges: [{ source: "a", target: "b" }], stats: STATS },
    { repository: REPO, nodes: [node], edges: [null], stats: STATS },
    { repository: REPO, nodes: [node], edges: [edge], stats: { ...STATS, truncated: "no" } },
    { repository: REPO, nodes: [node], edges: [edge], stats: { ...STATS, filesAnalyzed: "many" } },
    { repository: REPO, nodes: [node], edges: [edge], stats: { truncated: false } },
  ];
  for (const payload of bad) {
    assertEqual(
      parseDependencyAnalysis(payload),
      null,
      `rejected: ${JSON.stringify(payload)?.slice(0, 90) ?? "undefined"}`
    );
  }
});

test("every numeric stat is required, not just some", () => {
  const keys = [
    "filesAnalyzed", "filesSkipped", "filesFailed", "dependenciesFound",
    "internalDependencies", "externalImports", "externalPackages", "unresolvedImports",
  ] as const;
  for (const key of keys) {
    const stats: Record<string, unknown> = { ...STATS };
    delete stats[key];
    assertEqual(
      parseDependencyAnalysis({ repository: REPO, nodes: [], edges: [], stats }),
      null,
      `missing ${key} is rejected`
    );
  }
});

test("prototype-pollution shaped payloads are rejected and pollute nothing", () => {
  const hostile = JSON.parse(
    '{"repository":{"owner":"o","name":"r","defaultBranch":"m"},"nodes":[],"edges":[],"stats":{},"__proto__":{"polluted":true}}'
  ) as unknown;
  assertEqual(parseDependencyAnalysis(hostile), null, "rejected on stats");
  assertEqual(
    ({} as Record<string, unknown>).polluted,
    undefined,
    "Object.prototype untouched"
  );
});

test("hostile strings in a valid shape are passed through as data, never executed", () => {
  const payload = {
    repository: { owner: "<script>", name: "</div>", defaultBranch: "`x`" },
    nodes: [
      { id: "<img src=x onerror=alert(1)>.ts", path: "<img src=x onerror=alert(1)>.ts", label: "<img>", type: "file" },
    ],
    edges: [],
    stats: STATS,
  };
  const parsed = parseDependencyAnalysis(payload);
  assert(parsed !== null, "accepted as data");
  assertEqual(parsed?.nodes[0].label, "<img>", "kept verbatim as a string for React to escape");
});

// ── workflow analysis ────────────────────────────────────────────────────

const WF_STATS = {
  workflowsFound: 1,
  workflowsAnalyzed: 1,
  workflowsFailed: 0,
  truncated: false,
};

const WF_STEP = { hasWith: false, hasEnv: false, uses: "actions/checkout@v4" };
const WF_JOB = {
  id: "build",
  name: "Build",
  needs: [],
  steps: [WF_STEP],
  stepCount: 1,
  stepsTruncated: false,
};
const WF = {
  path: ".github/workflows/ci.yml",
  name: "CI",
  triggers: [{ event: "push" }],
  jobs: [WF_JOB],
  jobCount: 1,
  jobsTruncated: false,
};

test("a well-formed workflow analysis is accepted", () => {
  const payload = { repository: REPO, workflows: [WF], stats: WF_STATS };
  assert(parseWorkflowAnalysis(payload) !== null, "accepted");
});

test("a repository with no workflows is valid", () => {
  const payload = {
    repository: REPO,
    workflows: [],
    stats: { ...WF_STATS, workflowsFound: 0, workflowsAnalyzed: 0 },
  };
  assert(parseWorkflowAnalysis(payload) !== null, "accepted");
});

test("a workflow carrying a parseError is still valid data", () => {
  const payload = {
    repository: REPO,
    workflows: [{ ...WF, jobs: [], jobCount: 0, parseError: "Invalid YAML" }],
    stats: { ...WF_STATS, workflowsAnalyzed: 0, workflowsFailed: 1 },
  };
  assert(parseWorkflowAnalysis(payload) !== null, "accepted so the UI can show it");
});

test("malformed workflow analyses are all rejected", () => {
  const bad: unknown[] = [
    null,
    undefined,
    "string",
    [],
    {},
    { repository: REPO, workflows: [] },
    { repository: REPO, stats: WF_STATS },
    { workflows: [], stats: WF_STATS },
    { repository: REPO, workflows: "no", stats: WF_STATS },
    { repository: REPO, workflows: [], stats: null },
    { repository: REPO, workflows: [], stats: { truncated: false } },
    { repository: REPO, workflows: [], stats: { ...WF_STATS, truncated: "no" } },
    { repository: REPO, workflows: [null], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, path: 1 }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, name: undefined }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, triggers: "no" }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, triggers: [{}] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: "no" }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [null] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [{ ...WF_JOB, id: 5 }] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [{ ...WF_JOB, needs: "build" }] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [{ ...WF_JOB, steps: "no" }] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [{ ...WF_JOB, steps: [{}] }] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobs: [{ ...WF_JOB, steps: [{ ...WF_STEP, run: 1 }] }] }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, jobCount: "1" }], stats: WF_STATS },
    { repository: REPO, workflows: [{ ...WF, parseError: 42 }], stats: WF_STATS },
  ];
  for (const payload of bad) {
    assertEqual(
      parseWorkflowAnalysis(payload),
      null,
      `rejected: ${JSON.stringify(payload)?.slice(0, 80) ?? "undefined"}`
    );
  }
});

test("hostile workflow strings pass through as data, never executed", () => {
  const payload = {
    repository: REPO,
    workflows: [
      {
        ...WF,
        name: "<script>alert(1)</script>",
        jobs: [
          {
            ...WF_JOB,
            name: '"] --> evil["',
            steps: [{ hasWith: false, hasEnv: false, run: "rm -rf /" }],
          },
        ],
      },
    ],
    stats: WF_STATS,
  };
  const parsed = parseWorkflowAnalysis(payload);
  assert(parsed !== null, "accepted as data");
  assertEqual(
    parsed?.workflows[0].jobs[0].steps[0].run,
    "rm -rf /",
    "kept verbatim as a string for React to escape; never run"
  );
});

// ── call graph analysis ──────────────────────────────────────────────────

const CG_NODE = {
  id: "a.ts::main",
  file: "a.ts",
  name: "main",
  displayName: "main",
  startLine: 1,
  endLine: 3,
  kind: "function-declaration",
  exported: true,
};

const CG_EDGE = { source: "a.ts::main", target: "a.ts::helper", callExpression: "helper()", line: 2, callCount: 1 };

const CG_ENTRY_POINT_ENTRY = { id: "a.ts::main", file: "a.ts", name: "main", startLine: 1, endLine: 3 };

const CG_STATS = {
  functionsDiscovered: 2,
  functionsReachable: 2,
  edges: 1,
  unresolvedCalls: 0,
  externalCalls: 0,
  maxDepth: 1,
};

test("a well-formed call graph analysis is accepted", () => {
  const payload = {
    repository: REPO,
    entryPoint: { functionId: "a.ts::main", file: "a.ts", name: "main" },
    nodes: [CG_NODE],
    edges: [CG_EDGE],
    availableEntryPoints: [CG_ENTRY_POINT_ENTRY],
    stats: CG_STATS,
    truncated: false,
  };
  assert(parseCallGraphAnalysis(payload) !== null, "accepted");
});

test("a null entry point (no functions in the repository) is valid", () => {
  const payload = {
    repository: REPO,
    entryPoint: null,
    nodes: [],
    edges: [],
    availableEntryPoints: [],
    stats: { ...CG_STATS, functionsDiscovered: 0, functionsReachable: 0, edges: 0, maxDepth: 0 },
    truncated: false,
  };
  assert(parseCallGraphAnalysis(payload) !== null, "accepted");
});

test("a truncationReason is accepted when present", () => {
  const payload = {
    repository: REPO,
    entryPoint: { functionId: "a.ts::main", file: "a.ts", name: "main" },
    nodes: [CG_NODE],
    edges: [],
    availableEntryPoints: [CG_ENTRY_POINT_ENTRY],
    stats: CG_STATS,
    truncated: true,
    truncationReason: "max_nodes",
  };
  assert(parseCallGraphAnalysis(payload) !== null, "accepted");
});

test("malformed call graph analyses are all rejected", () => {
  const good = {
    repository: REPO,
    entryPoint: { functionId: "a.ts::main", file: "a.ts", name: "main" },
    nodes: [CG_NODE],
    edges: [CG_EDGE],
    availableEntryPoints: [CG_ENTRY_POINT_ENTRY],
    stats: CG_STATS,
    truncated: false,
  };
  const bad: unknown[] = [
    null,
    undefined,
    "string",
    42,
    [],
    {},
    { ...good, repository: undefined },
    { ...good, entryPoint: "x" },
    { ...good, entryPoint: { functionId: 1, file: "a.ts", name: "main" } },
    { ...good, nodes: undefined },
    { ...good, nodes: [{ ...CG_NODE, id: undefined }] },
    { ...good, nodes: [{ ...CG_NODE, exported: "yes" }] },
    { ...good, edges: [{ ...CG_EDGE, callCount: "1" }] },
    { ...good, availableEntryPoints: [{ id: "a" }] },
    { ...good, stats: undefined },
    { ...good, stats: { ...CG_STATS, unresolvedCalls: "0" } },
    { ...good, truncated: "no" },
    { ...good, truncationReason: 42 },
  ];
  for (const payload of bad) {
    assertEqual(parseCallGraphAnalysis(payload), null, `rejected: ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

test("hostile call graph strings pass through as data, never executed", () => {
  const payload = {
    repository: REPO,
    entryPoint: { functionId: "a.ts::main", file: "a.ts", name: '"] --> evil["' },
    nodes: [{ ...CG_NODE, displayName: "<script>alert(1)</script>" }],
    edges: [{ ...CG_EDGE, callExpression: "sequenceDiagram\nactor Evil" }],
    availableEntryPoints: [CG_ENTRY_POINT_ENTRY],
    stats: CG_STATS,
    truncated: false,
  };
  const parsed = parseCallGraphAnalysis(payload);
  assert(parsed !== null, "accepted as data");
  assertEqual(
    parsed?.nodes[0].displayName,
    "<script>alert(1)</script>",
    "kept verbatim as a string for the Mermaid generator to escape; never interpreted here"
  );
});

// ── git history (Phase 7) ────────────────────────────────────────────────

const AUTHOR = { name: "Ada", email: "ada@example.com", login: "ada", avatarUrl: null };
const COMMIT = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  message: "fix: a bug",
  author: AUTHOR,
  committer: AUTHOR,
  date: "2024-01-01T00:00:00Z",
  url: "https://github.com/o/r/commit/a",
};
const CHANGED_FILE = {
  path: "a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  previousPath: null,
  patchAvailable: true,
};
const COMMIT_STATS = { filesChanged: 1, additions: 1, deletions: 1 };
const PAGINATION = { page: 1, perPage: 30, hasNextPage: false };

test("a well-formed repository history is accepted", () => {
  const payload = { repository: REPO, commits: [COMMIT], pagination: PAGINATION };
  assert(parseRepositoryHistory(payload) !== null, "accepted");
});

test("an empty commit list is valid", () => {
  assert(parseRepositoryHistory({ repository: REPO, commits: [], pagination: PAGINATION }) !== null, "accepted");
});

test("malformed repository histories are rejected", () => {
  const bad: unknown[] = [
    null,
    {},
    { repository: REPO, commits: [COMMIT] },
    { repository: REPO, commits: "nope", pagination: PAGINATION },
    { repository: REPO, commits: [{ ...COMMIT, sha: undefined }], pagination: PAGINATION },
    { repository: REPO, commits: [{ ...COMMIT, author: null }], pagination: PAGINATION },
    { repository: REPO, commits: [COMMIT], pagination: { page: "1", perPage: 30, hasNextPage: false } },
  ];
  for (const payload of bad) {
    assertEqual(parseRepositoryHistory(payload), null, `rejected: ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

test("a commit not linked to a GitHub account (null login/avatar) is still valid", () => {
  const payload = {
    repository: REPO,
    commits: [{ ...COMMIT, author: { ...AUTHOR, login: null, avatarUrl: null } }],
    pagination: PAGINATION,
  };
  assert(parseRepositoryHistory(payload) !== null, "accepted");
});

test("a well-formed commit detail is accepted", () => {
  const payload = { commit: COMMIT, stats: COMMIT_STATS, files: [CHANGED_FILE], filesTruncated: false };
  assert(parseCommitDetail(payload) !== null, "accepted");
});

test("an unrecognised changed-file status is rejected rather than guessed", () => {
  const payload = {
    commit: COMMIT,
    stats: COMMIT_STATS,
    files: [{ ...CHANGED_FILE, status: "exploded" }],
    filesTruncated: false,
  };
  assertEqual(parseCommitDetail(payload), null, "rejected");
});

test("a renamed file (previousPath set) is valid", () => {
  const payload = {
    commit: COMMIT,
    stats: COMMIT_STATS,
    files: [{ ...CHANGED_FILE, status: "renamed", previousPath: "old.ts" }],
    filesTruncated: false,
  };
  assert(parseCommitDetail(payload) !== null, "accepted");
});

test("a well-formed commit comparison is accepted", () => {
  const payload = {
    repository: REPO,
    base: COMMIT,
    head: { ...COMMIT, sha: "b".repeat(40) },
    stats: COMMIT_STATS,
    files: [CHANGED_FILE],
    filesTruncated: false,
  };
  assert(parseCommitComparison(payload) !== null, "accepted");
});

test("malformed commit comparisons are rejected", () => {
  const bad: unknown[] = [
    null,
    { repository: REPO, base: COMMIT },
    { repository: REPO, base: COMMIT, head: "not an object", stats: COMMIT_STATS, files: [], filesTruncated: false },
  ];
  for (const payload of bad) {
    assertEqual(parseCommitComparison(payload), null, `rejected: ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

const FILE_HISTORY_STATS = { totalCommits: 1, activeAuthors: 1, averageChangesPerCommit: null, recentChangeRate: 0 };

test("a well-formed file history, with additions/deletions omitted, is accepted", () => {
  const payload = {
    repository: REPO,
    path: "a.ts",
    entries: [{ sha: COMMIT.sha, shortSha: COMMIT.shortSha, date: COMMIT.date, message: COMMIT.message, author: AUTHOR }],
    pagination: PAGINATION,
    stats: FILE_HISTORY_STATS,
  };
  assert(parseFileHistory(payload) !== null, "accepted — a null averageChangesPerCommit is not an error");
});

test("a file history entry's additions/deletions, when present, must be numbers", () => {
  const payload = {
    repository: REPO,
    path: "a.ts",
    entries: [{ sha: "a", shortSha: "a", date: COMMIT.date, message: "m", author: AUTHOR, additions: "one" }],
    pagination: PAGINATION,
    stats: FILE_HISTORY_STATS,
  };
  assertEqual(parseFileHistory(payload), null, "rejected");
});

test("a well-formed history-stats payload is accepted", () => {
  const payload = {
    repository: REPO,
    hotspots: [{ path: "a.ts", commits: 3, additions: 10, deletions: 2 }],
    contributors: [{ name: "Ada", login: "ada", commits: 3, filesChanged: 5, additions: 10, deletions: 2 }],
    commitsAnalyzed: 3,
    truncated: false,
  };
  assert(parseHistoryStats(payload) !== null, "accepted");
});

test("a contributor with no linked GitHub account (null login) is valid", () => {
  const payload = {
    repository: REPO,
    hotspots: [],
    contributors: [{ name: "Ada", login: null, commits: 1, filesChanged: 1, additions: 1, deletions: 0 }],
    commitsAnalyzed: 1,
    truncated: false,
  };
  assert(parseHistoryStats(payload) !== null, "accepted");
});

const IMPACT_NODE = { id: "a.ts", path: "a.ts", relationship: "changed", depth: 0 };
const IMPACT_STATS = { changedFiles: 1, affectedFiles: 0, maxDepth: 0 };
const FUNCTION_IMPACT = { available: false, changedFunctions: [], affectedFunctions: [] };

test("a well-formed impact analysis is accepted", () => {
  const payload = {
    repository: REPO,
    comparison: { base: "a", head: "b" },
    changedFiles: ["a.ts"],
    affectedFiles: [],
    nodes: [IMPACT_NODE],
    edges: [],
    stats: IMPACT_STATS,
    functionImpact: FUNCTION_IMPACT,
    warnings: [],
    truncated: false,
  };
  assert(parseImpactAnalysis(payload) !== null, "accepted");
});

test("an unrecognised relationship value is rejected rather than guessed", () => {
  const payload = {
    repository: REPO,
    comparison: { base: "a", head: "b" },
    changedFiles: ["a.ts"],
    affectedFiles: [],
    nodes: [{ ...IMPACT_NODE, relationship: "definitely-broken" }],
    edges: [],
    stats: IMPACT_STATS,
    functionImpact: FUNCTION_IMPACT,
    warnings: [],
    truncated: false,
  };
  assertEqual(parseImpactAnalysis(payload), null, "rejected");
});

test("a truncationReason is accepted when present", () => {
  const payload = {
    repository: REPO,
    comparison: { base: "a", head: "b" },
    changedFiles: ["a.ts"],
    affectedFiles: [],
    nodes: [IMPACT_NODE],
    edges: [],
    stats: IMPACT_STATS,
    functionImpact: FUNCTION_IMPACT,
    warnings: ["Impact analysis is based on statically resolved dependencies and may not capture dynamic runtime relationships."],
    truncated: true,
    truncationReason: "max_depth",
  };
  assert(parseImpactAnalysis(payload) !== null, "accepted");
});

test("hostile paths and commit messages in history payloads pass through as data, never executed", () => {
  const payload = {
    repository: REPO,
    comparison: { base: "a", head: "b" },
    changedFiles: ['"; sequenceDiagram\nactor Evil'],
    affectedFiles: [],
    nodes: [{ ...IMPACT_NODE, id: "../../etc/passwd", path: "../../etc/passwd" }],
    edges: [],
    stats: IMPACT_STATS,
    functionImpact: FUNCTION_IMPACT,
    warnings: [],
    truncated: false,
  };
  const parsed = parseImpactAnalysis(payload);
  assert(parsed !== null, "accepted as data");
  assertEqual(parsed?.nodes[0].path, "../../etc/passwd", "kept verbatim, never resolved against a filesystem");
});

// ── database schema (Phase 8) ────────────────────────────────────────────

const SCHEMA_FIELD = {
  id: "User.id",
  name: "id",
  type: "Int",
  nullable: false,
  primaryKey: true,
  unique: false,
  array: false,
};
const SCHEMA_MODEL = {
  id: "prisma:schema.prisma:User",
  name: "User",
  sourceType: "prisma",
  sourcePath: "schema.prisma",
  fields: [SCHEMA_FIELD],
  indexes: [],
};
const SCHEMA_RELATIONSHIP = {
  id: "User->Post",
  sourceModel: "User",
  targetModel: "Post",
  cardinality: "1:N",
  inferred: false,
};
const SCHEMA_STATS = {
  models: 1,
  fields: 1,
  relationships: 0,
  primaryKeys: 1,
  foreignKeys: 0,
  indexes: 0,
  byProvider: { prisma: 1 },
};

test("a well-formed schema analysis is accepted", () => {
  const payload = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [SCHEMA_MODEL],
    relationships: [],
    nodes: [{ id: SCHEMA_MODEL.id, model: SCHEMA_MODEL }],
    edges: [],
    stats: SCHEMA_STATS,
    warnings: [],
    truncated: false,
  };
  assert(parseSchemaAnalysis(payload) !== null, "accepted");
});

test("a repository with no detected schema is valid", () => {
  const payload = {
    repository: REPO,
    providers: [],
    schemas: [],
    relationships: [],
    nodes: [],
    edges: [],
    stats: { ...SCHEMA_STATS, models: 0, fields: 0, primaryKeys: 0, byProvider: {} },
    warnings: ["No supported database schema definitions were detected."],
    truncated: false,
  };
  assert(parseSchemaAnalysis(payload) !== null, "accepted — absence of a schema is not an error");
});

test("an unrecognised sourceType is rejected rather than guessed", () => {
  const payload = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [{ ...SCHEMA_MODEL, sourceType: "graphql" }],
    relationships: [],
    nodes: [],
    edges: [],
    stats: SCHEMA_STATS,
    warnings: [],
    truncated: false,
  };
  assertEqual(parseSchemaAnalysis(payload), null, "rejected");
});

test("an unrecognised cardinality is rejected rather than guessed", () => {
  const payload = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [SCHEMA_MODEL],
    relationships: [{ ...SCHEMA_RELATIONSHIP, cardinality: "many-to-many-ish" }],
    nodes: [],
    edges: [],
    stats: SCHEMA_STATS,
    warnings: [],
    truncated: false,
  };
  assertEqual(parseSchemaAnalysis(payload), null, "rejected");
});

test("malformed schema analyses are all rejected", () => {
  const good = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [SCHEMA_MODEL],
    relationships: [SCHEMA_RELATIONSHIP],
    nodes: [{ id: SCHEMA_MODEL.id, model: SCHEMA_MODEL }],
    edges: [{ id: "e1", source: "a", target: "b", relationship: SCHEMA_RELATIONSHIP }],
    stats: SCHEMA_STATS,
    warnings: [],
    truncated: false,
  };
  const bad: unknown[] = [
    null,
    {},
    { ...good, repository: undefined },
    { ...good, schemas: [{ ...SCHEMA_MODEL, fields: undefined }] },
    { ...good, nodes: [{ id: "x" }] },
    { ...good, edges: [{ id: "e1", source: "a", target: "b" }] },
    { ...good, stats: undefined },
    { ...good, stats: { ...SCHEMA_STATS, models: "1" } },
    { ...good, truncated: "no" },
  ];
  for (const payload of bad) {
    assertEqual(parseSchemaAnalysis(payload), null, `rejected: ${JSON.stringify(payload) ?? "undefined"}`);
  }
});

test("truncated with a reason is accepted", () => {
  const payload = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [SCHEMA_MODEL],
    relationships: [],
    nodes: [{ id: SCHEMA_MODEL.id, model: SCHEMA_MODEL }],
    edges: [],
    stats: SCHEMA_STATS,
    warnings: ["Schema exceeded configured visualization limits."],
    truncated: true,
    truncationReason: "max_models",
  };
  assert(parseSchemaAnalysis(payload) !== null, "accepted");
});

test("hostile model and field names pass through as data, never executed", () => {
  const payload = {
    repository: REPO,
    providers: ["prisma"],
    schemas: [
      {
        ...SCHEMA_MODEL,
        name: "<script>alert(1)</script>",
        fields: [{ ...SCHEMA_FIELD, name: "'; DROP TABLE users; --" }],
      },
    ],
    relationships: [],
    nodes: [],
    edges: [],
    stats: SCHEMA_STATS,
    warnings: [],
    truncated: false,
  };
  const parsed = parseSchemaAnalysis(payload);
  assert(parsed !== null, "accepted as data");
  assertEqual(parsed?.schemas[0].name, "<script>alert(1)</script>", "kept verbatim, never interpreted");
  assertEqual(parsed?.schemas[0].fields[0].name, "'; DROP TABLE users; --", "kept verbatim, never executed");
});

await report("backend response contract tests");
