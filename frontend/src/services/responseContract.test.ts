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
  parseDependencyAnalysis,
  parseRepositoryTree,
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

await report("backend response contract tests");
