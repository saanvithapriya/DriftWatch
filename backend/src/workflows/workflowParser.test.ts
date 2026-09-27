/**
 * Tests for GitHub Actions workflow parsing and normalization.
 *
 * Run with:  npx tsx src/workflows/workflowParser.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import {
  DEFAULT_WORKFLOW_LIMITS,
  deriveWorkflowName,
  isWorkflowPath,
  normalizeNeeds,
  normalizeTriggers,
  parseWorkflow,
} from "./workflowParser.js";

const PATH = ".github/workflows/ci.yml";
const wf = (yaml: string, path = PATH) => parseWorkflow(path, yaml);
const events = (yaml: string) => wf(yaml).triggers.map((t) => t.event);

// ── discovery ────────────────────────────────────────────────────────────

test("only .github/workflows yml and yaml files are recognised", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/deploy.yaml",
    ".github/workflows/Release.YML",
  ]) {
    assertEqual(isWorkflowPath(path), true, `recognised: ${path}`);
  }
  for (const path of [
    ".github/workflow/ci.yml",
    ".github/workflows/nested/ci.yml",
    ".github/ci.yml",
    "workflows/ci.yml",
    "src/ci.yml",
    ".github/workflows/README.md",
    ".github/workflows/ci.yml.bak",
    "a/.github/workflows/ci.yml",
  ]) {
    assertEqual(isWorkflowPath(path), false, `ignored: ${path}`);
  }
});

// ── the `on:` key must never become boolean true ─────────────────────────

test("MANDATORY: `on` is never coerced to boolean true", () => {
  // YAML 1.1 treats `on` as a boolean. If that happened here every workflow
  // would silently lose its triggers.
  const shapes = [
    ["object", "on:\n  push:\n  pull_request:\njobs: {}", ["pull_request", "push"]],
    ["scalar", "on: workflow_dispatch\njobs: {}", ["workflow_dispatch"]],
    ["array", "on: [push, pull_request]\njobs: {}", ["pull_request", "push"]],
    ["quoted", '"on":\n  push:\njobs: {}', ["push"]],
    ["schedule", 'on:\n  schedule:\n    - cron: "0 0 * * *"\njobs: {}', ["schedule"]],
  ] as const;

  for (const [label, yaml, expected] of shapes) {
    const parsed = wf(yaml);
    assertEqual(parsed.triggers.map((t) => t.event), expected, `${label} form`);
    assert(
      !parsed.triggers.some((t) => t.event === "true"),
      `${label}: no boolean-coerced trigger`
    );
    assertEqual(parsed.parseError, undefined, `${label}: parsed cleanly`);
  }
});

test("`off`, `yes` and `no` keys are likewise not coerced", () => {
  const parsed = wf("on:\n  push:\njobs:\n  off: {}\n  yes: {}\n  no: {}");
  assertEqual(parsed.jobs.map((j) => j.id), ["no", "off", "yes"], "job ids kept as written");
});

// ── triggers ─────────────────────────────────────────────────────────────

test("common trigger events are all preserved", () => {
  const all = [
    "push", "pull_request", "workflow_dispatch", "workflow_call", "schedule",
    "release", "workflow_run", "issues", "issue_comment", "deployment",
    "deployment_status", "create", "delete",
  ];
  const yaml = `on:\n${all.map((e) => `  ${e}:`).join("\n")}\njobs: {}`;
  assertEqual(events(yaml), [...all].sort(), "every event kept, sorted");
});

test("trigger metadata is normalized without evaluating anything", () => {
  const parsed = wf(
    [
      "on:",
      "  push:",
      "    branches: [main, release/*]",
      "    tags: ['v*']",
      "    paths: ['src/**']",
      "  pull_request:",
      "    types: [opened, synchronize]",
      "    branches-ignore: [wip]",
      "  schedule:",
      '    - cron: "0 0 * * *"',
      '    - cron: "30 6 * * 1"',
      "jobs: {}",
    ].join("\n")
  );

  const byEvent = new Map(parsed.triggers.map((t) => [t.event, t]));
  assertEqual(byEvent.get("push")?.branches, ["main", "release/*"], "branches");
  assertEqual(byEvent.get("push")?.tags, ["v*"], "tags");
  assertEqual(byEvent.get("push")?.paths, ["src/**"], "paths");
  assertEqual(byEvent.get("pull_request")?.types, ["opened", "synchronize"], "types");
  assertEqual(byEvent.get("pull_request")?.branchesIgnore, ["wip"], "branches-ignore");
  assertEqual(byEvent.get("schedule")?.cron, ["0 0 * * *", "30 6 * * 1"], "cron list");
});

test("a missing `on` yields no triggers rather than failing", () => {
  const parsed = wf("name: CI\njobs:\n  build: {}");
  assertEqual(parsed.triggers, [], "no triggers");
  assertEqual(parsed.parseError, undefined, "still valid");
  assertEqual(parsed.jobs.length, 1, "jobs still parsed");
});

test("normalizeTriggers handles junk without throwing", () => {
  for (const input of [undefined, null, 42, true, [], {}, [null, 1]]) {
    const result = normalizeTriggers(input);
    assert(Array.isArray(result), `array for ${JSON.stringify(input) ?? "undefined"}`);
  }
});

// ── name ─────────────────────────────────────────────────────────────────

test("the workflow name comes from `name:` when present", () => {
  assertEqual(wf("name: My Pipeline\njobs: {}").name, "My Pipeline", "explicit name");
});

test("a missing name is derived from the filename", () => {
  assertEqual(deriveWorkflowName(".github/workflows/ci.yml"), "CI", "ci.yml -> CI");
  assertEqual(deriveWorkflowName(".github/workflows/deploy.yaml"), "Deploy", "deploy");
  assertEqual(deriveWorkflowName(".github/workflows/release-please.yml"), "Release Please", "hyphens");
  assertEqual(deriveWorkflowName(".github/workflows/e2e_tests.yml"), "E2E Tests", "underscore + acronym");
  assertEqual(wf("jobs: {}", ".github/workflows/ci.yml").name, "CI", "used when name is absent");
});

// ── jobs ─────────────────────────────────────────────────────────────────

test("every job under `jobs:` becomes a normalized job", () => {
  const parsed = wf("on: push\njobs:\n  build: {}\n  test: {}\n  deploy: {}");
  assertEqual(parsed.jobs.map((j) => j.id), ["build", "deploy", "test"], "three jobs, sorted");
  assertEqual(parsed.jobCount, 3, "count");
});

test("a job's display name falls back to its id", () => {
  const parsed = wf("on: push\njobs:\n  build:\n    name: Build the app\n  test: {}");
  const byId = new Map(parsed.jobs.map((j) => [j.id, j]));
  assertEqual(byId.get("build")?.name, "Build the app", "explicit");
  assertEqual(byId.get("test")?.name, "test", "fallback to id");
});

test("an empty or missing jobs section is valid", () => {
  assertEqual(wf("on: push\njobs: {}").jobs, [], "empty map");
  assertEqual(wf("on: push").jobs, [], "missing entirely");
  assertEqual(wf("on: push").parseError, undefined, "not an error");
});

test("job metadata useful for display is extracted", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    if: github.ref == 'refs/heads/main'",
      "    environment: production",
      "    timeout-minutes: 30",
      "    continue-on-error: true",
      "    steps:",
      "      - run: echo hi",
    ].join("\n")
  );
  const job = parsed.jobs[0];
  assertEqual(job.runsOn, "ubuntu-latest", "runs-on");
  assertEqual(job.if, "github.ref == 'refs/heads/main'", "condition kept as text");
  assertEqual(job.environment, "production", "environment");
  assertEqual(job.timeoutMinutes, 30, "timeout");
  assertEqual(job.continueOnError, true, "continue-on-error");
});

test("runs-on in list and object forms is rendered readably", () => {
  assertEqual(
    wf("on: push\njobs:\n  a:\n    runs-on: [self-hosted, linux]").jobs[0].runsOn,
    "self-hosted, linux",
    "list form"
  );
  assertEqual(
    wf("on: push\njobs:\n  a:\n    runs-on:\n      group: ci\n      labels: [big, linux]").jobs[0].runsOn,
    "big, linux",
    "object form with labels"
  );
});

test("environment given as an object uses its name", () => {
  const parsed = wf("on: push\njobs:\n  a:\n    environment:\n      name: prod\n      url: https://x");
  assertEqual(parsed.jobs[0].environment, "prod", "name extracted");
});

// ── needs ────────────────────────────────────────────────────────────────

test("needs is normalized from both scalar and list forms", () => {
  assertEqual(normalizeNeeds("build"), ["build"], "scalar");
  assertEqual(normalizeNeeds(["build", "lint"]), ["build", "lint"], "list");
  assertEqual(normalizeNeeds(undefined), [], "absent");
  assertEqual(normalizeNeeds([]), [], "empty list");
  assertEqual(normalizeNeeds(["b", "a", "b"]), ["a", "b"], "deduplicated and sorted");
});

test("needs produces dependencies only when written explicitly", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  build: {}",
      "  lint: {}",
      "  test:",
      "    needs: build",
      "  deploy:",
      "    needs: [build, lint]",
    ].join("\n")
  );
  const byId = new Map(parsed.jobs.map((j) => [j.id, j]));
  assertEqual(byId.get("build")?.needs, [], "no dependency inferred from order");
  assertEqual(byId.get("lint")?.needs, [], "none");
  assertEqual(byId.get("test")?.needs, ["build"], "scalar needs");
  assertEqual(byId.get("deploy")?.needs, ["build", "lint"], "list needs");
});

// ── steps ────────────────────────────────────────────────────────────────

test("steps preserve their order and their fields", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: Install",
      "        id: install",
      "        run: npm ci",
      "      - name: Test",
      "        run: npm test",
      "        if: success()",
    ].join("\n")
  );
  const steps = parsed.jobs[0].steps;
  assertEqual(steps.length, 3, "three steps");
  assertEqual(steps[0].uses, "actions/checkout@v4", "uses kept verbatim");
  assertEqual(steps[1].name, "Install", "name");
  assertEqual(steps[1].id, "install", "id");
  assertEqual(steps[1].run, "npm ci", "run kept as text");
  assertEqual(steps[2].if, "success()", "condition kept as text");
  assertEqual(steps.map((s) => s.name ?? s.uses), ["actions/checkout@v4", "Install", "Test"], "order preserved");
});

test("with and env are recorded as presence only, never as values", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "          token: ${{ secrets.NPM_TOKEN }}",
      "        env:",
      "          API_KEY: ${{ secrets.API_KEY }}",
      "      - run: echo plain",
    ].join("\n")
  );
  const [withStep, plainStep] = parsed.jobs[0].steps;
  assertEqual(withStep.hasWith, true, "with detected");
  assertEqual(withStep.hasEnv, true, "env detected");
  assertEqual(plainStep.hasWith, false, "absent");
  assertEqual(plainStep.hasEnv, false, "absent");

  const serialized = JSON.stringify(parsed);
  assert(!serialized.includes("NPM_TOKEN"), "with values never carried");
  assert(!serialized.includes("API_KEY"), "env values never carried");
});

test("a multiline run script is kept as text and never executed", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: |",
      "          echo one",
      "          rm -rf /tmp/nothing",
      "          echo two",
    ].join("\n")
  );
  const run = parsed.jobs[0].steps[0].run ?? "";
  assert(run.includes("echo one") && run.includes("echo two"), "full script kept as text");
});

test("an enormous run script is truncated rather than carried whole", () => {
  const huge = "x".repeat(50000);
  const parsed = wf(`on: push\njobs:\n  a:\n    steps:\n      - run: ${huge}`);
  const run = parsed.jobs[0].steps[0].run ?? "";
  assert(run.length < 3000, `clamped, got ${run.length}`);
  assert(run.includes("truncated"), "says so");
});

// ── matrix and reusable workflows ────────────────────────────────────────

test("a matrix is described, never expanded into combinations", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  test:",
      "    strategy:",
      "      matrix:",
      "        node: [18, 20, 22]",
      "        os: [ubuntu-latest, windows-latest]",
      "        include:",
      "          - node: 18",
      "            experimental: true",
    ].join("\n")
  );
  const matrix = parsed.jobs[0].matrix;
  assertEqual(
    matrix?.dimensions,
    [
      { key: "node", values: ["18", "20", "22"] },
      { key: "os", values: ["ubuntu-latest", "windows-latest"] },
    ],
    "dimensions described, sorted"
  );
  assertEqual(matrix?.hasInclude, true, "include noted");
  assertEqual(matrix?.hasExclude, false, "exclude absent");
  // 3 x 2 = 6 combinations must NOT become six jobs.
  assertEqual(parsed.jobs.length, 1, "still one job");
});

test("a reusable-workflow job is recorded as metadata, never followed", () => {
  const parsed = wf(
    [
      "on: push",
      "jobs:",
      "  local:",
      "    uses: ./.github/workflows/deploy.yml",
      "  remote:",
      "    uses: org/repo/.github/workflows/deploy.yml@main",
      "    needs: local",
    ].join("\n")
  );
  const byId = new Map(parsed.jobs.map((j) => [j.id, j]));
  assertEqual(byId.get("local")?.uses, "./.github/workflows/deploy.yml", "local reference");
  assertEqual(byId.get("remote")?.uses, "org/repo/.github/workflows/deploy.yml@main", "remote reference");
  assertEqual(byId.get("remote")?.needs, ["local"], "needs still works");
  assertEqual(byId.get("local")?.steps, [], "no steps invented");
});

// ── malformed and hostile input ──────────────────────────────────────────

test("malformed YAML produces a parseError instead of throwing", () => {
  const cases = [
    ["unclosed quote", 'name: "CI\njobs: {}'],
    ["tab indentation", "jobs:\n\tbuild: {}"],
    ["bad structure", "jobs:\n  build:\n   steps:\n  - bad"],
  ] as const;

  for (const [label, yaml] of cases) {
    const parsed = wf(yaml);
    assert(parsed.parseError !== undefined, `${label}: reported`);
    assertEqual(parsed.jobs, [], `${label}: no jobs`);
    assert(parsed.name.length > 0, `${label}: still has a display name`);
    assert((parsed.parseError ?? "").length <= 200, `${label}: message is bounded`);
  }
});

test("a non-mapping or empty workflow is reported clearly", () => {
  assert((wf("") .parseError ?? "").includes("empty"), "empty file");
  assert((wf("# just a comment").parseError ?? "").includes("empty"), "comments only");
  assert((wf("- a\n- b").parseError ?? "").includes("mapping"), "list document");
  assert((wf("just a string").parseError ?? "").includes("mapping"), "scalar document");
});

test("wrong YAML types in the right places do not throw", () => {
  const cases = [
    "on: push\njobs: 42",
    "on: push\njobs:\n  build: 'not a map'",
    "on: push\njobs:\n  build:\n    steps: 'not a list'",
    "on: push\njobs:\n  build:\n    steps:\n      - 42",
    "on: push\njobs:\n  build:\n    needs: 42",
    "on: 42\njobs: {}",
    "name: 42\non: push\njobs: {}",
  ];
  for (const yaml of cases) {
    const parsed = wf(yaml);
    assert(Array.isArray(parsed.jobs), `jobs is an array for: ${yaml.slice(0, 30)}`);
    assert(Array.isArray(parsed.triggers), "triggers is an array");
  }
});

test("unicode, comments, CRLF and a BOM are handled", () => {
  const parsed = wf(
    "\uFEFF# a comment\r\nname: 構築 🚀\r\non:\r\n  push:\r\njobs:\r\n  café:\r\n    name: Déployer\r\n    steps:\r\n      - run: echo 日本語\r\n"
  );
  assertEqual(parsed.parseError, undefined, "parsed");
  assertEqual(parsed.name, "構築 🚀", "unicode name");
  assertEqual(parsed.jobs[0].id, "café", "unicode job id");
  assertEqual(parsed.jobs[0].name, "Déployer", "unicode job name");
  assertEqual(parsed.jobs[0].steps[0].run, "echo 日本語", "unicode step");
});

test("special characters in names are kept verbatim as data", () => {
  const hostile = 'name: "<script>alert(1)</script>"\non: push\njobs:\n  j:\n    name: \'a"b`c[d]e{f}\'';
  const parsed = wf(hostile);
  assertEqual(parsed.name, "<script>alert(1)</script>", "kept as a string");
  assertEqual(parsed.jobs[0].name, 'a"b`c[d]e{f}', "kept as a string");
});

// ── limits and determinism ───────────────────────────────────────────────

test("job and step limits truncate and say so", () => {
  const jobs = Array.from({ length: 12 }, (_, i) => `  j${String(i).padStart(2, "0")}: {}`).join("\n");
  const limited = parseWorkflow(PATH, `on: push\njobs:\n${jobs}`, {
    maxJobsPerWorkflow: 5,
    maxStepsPerJob: 2,
  });
  assertEqual(limited.jobs.length, 5, "jobs capped");
  assertEqual(limited.jobCount, 12, "true count reported");
  assertEqual(limited.jobsTruncated, true, "flagged");

  const steps = Array.from({ length: 9 }, () => "      - run: echo hi").join("\n");
  const stepLimited = parseWorkflow(PATH, `on: push\njobs:\n  a:\n    steps:\n${steps}`, {
    maxJobsPerWorkflow: 5,
    maxStepsPerJob: 2,
  });
  assertEqual(stepLimited.jobs[0].steps.length, 2, "steps capped");
  assertEqual(stepLimited.jobs[0].stepCount, 9, "true count reported");
  assertEqual(stepLimited.jobs[0].stepsTruncated, true, "flagged");
});

test("a complete workflow is not flagged as truncated", () => {
  const parsed = parseWorkflow(PATH, "on: push\njobs:\n  a:\n    steps:\n      - run: x", DEFAULT_WORKFLOW_LIMITS);
  assertEqual(parsed.jobsTruncated, false, "jobs complete");
  assertEqual(parsed.jobs[0].stepsTruncated, false, "steps complete");
});

test("parsing is deterministic and independent of job ordering", () => {
  const a = "on: push\njobs:\n  zeta:\n    needs: alpha\n  alpha: {}\n  mid: {}";
  const b = "on: push\njobs:\n  mid: {}\n  alpha: {}\n  zeta:\n    needs: alpha";
  assertEqual(JSON.stringify(wf(a)), JSON.stringify(wf(b)), "same result whatever the order");
  assertEqual(JSON.stringify(wf(a)), JSON.stringify(wf(a)), "stable across runs");
});

await report("GitHub Actions workflow parser tests");
