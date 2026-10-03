/**
 * Tests for workflow job-graph Mermaid generation: determinism, escaping and
 * injection resistance.
 *
 * Run with:  npx tsx src/workflows/workflowMermaid.test.ts
 */
import type { Workflow, WorkflowJob } from "../types/workflows";
import { assert, assertEqual, report, test } from "../utils/testHarness";
import {
  MAX_WORKFLOW_GRAPH_NODES,
  describeJob,
  generateWorkflowDiagram,
} from "./workflowMermaid";

function job(id: string, extra: Partial<WorkflowJob> = {}): WorkflowJob {
  return {
    id,
    name: extra.name ?? id,
    needs: extra.needs ?? [],
    steps: extra.steps ?? [],
    stepCount: extra.stepCount ?? (extra.steps?.length ?? 0),
    stepsTruncated: extra.stepsTruncated ?? false,
    ...extra,
  };
}

function workflow(jobs: WorkflowJob[], name = "CI"): Workflow {
  return {
    path: ".github/workflows/ci.yml",
    name,
    triggers: [],
    jobs,
    jobCount: jobs.length,
    jobsTruncated: false,
  };
}

const definitionOf = (wf: Workflow): string =>
  generateWorkflowDiagram(wf).definition as string;

function edges(definition: string): string[] {
  return definition.split("\n").filter((l) => l.includes("-->")).map((l) => l.trim());
}

function nodeIds(definition: string): string[] {
  const ids: string[] = [];
  for (const line of definition.split("\n")) {
    const match = /^ {2}([A-Za-z0-9_]+)\[/.exec(line);
    if (match !== null) ids.push(match[1]);
  }
  return ids;
}

// ── shapes ───────────────────────────────────────────────────────────────

test("a workflow with no jobs produces no diagram", () => {
  const out = generateWorkflowDiagram(workflow([]));
  assertEqual(out.definition, null, "nothing to draw");
  assertEqual(out.nodeCount, 0, "no jobs");
  assertEqual(out.exceededMaxNodes, false, "not a limit problem");
});

test("a single job produces one node and no edges", () => {
  const definition = definitionOf(workflow([job("build")]));
  assert(definition.startsWith("flowchart TD"), "flowchart header");
  assertEqual(nodeIds(definition), ["job_1"], "one node");
  assertEqual(edges(definition), [], "no edges");
});

test("a linear chain produces one edge per dependency", () => {
  const definition = definitionOf(
    workflow([job("build"), job("deploy", { needs: ["test"] }), job("test", { needs: ["build"] })])
  );
  // Ids follow the jobs' order: build=job_1, deploy=job_2, test=job_3.
  // Edges are emitted per job, so compare as a set of relationships.
  assertEqual(
    [...edges(definition)].sort(),
    ["job_1 --> job_3", "job_3 --> job_2"].sort(),
    "build -> test -> deploy"
  );
});

test("fan-out and fan-in are both represented", () => {
  const fanOut = definitionOf(
    workflow([job("build"), job("lint", { needs: ["build"] }), job("test", { needs: ["build"] })])
  );
  assertEqual(edges(fanOut).length, 2, "build feeds two jobs");

  const fanIn = definitionOf(
    workflow([job("deploy", { needs: ["lint", "test"] }), job("lint"), job("test")])
  );
  assertEqual(edges(fanIn).length, 2, "two jobs feed deploy");
});

test("independent jobs produce nodes but no edges", () => {
  const definition = definitionOf(workflow([job("a"), job("b"), job("c")]));
  assertEqual(nodeIds(definition).length, 3, "three nodes");
  assertEqual(edges(definition), [], "no edges");
});

test("a dependency cycle is drawn without hanging", () => {
  const definition = definitionOf(
    workflow([job("a", { needs: ["b"] }), job("b", { needs: ["a"] })])
  );
  assertEqual(edges(definition).length, 2, "both directions drawn");
});

test("duplicate dependencies collapse into one edge", () => {
  // `needs` is deduplicated upstream, but the generator guards too.
  const definition = definitionOf(
    workflow([job("a"), job("b", { needs: ["a", "a"] })])
  );
  assertEqual(edges(definition).length, 1, "one edge");
});

test("a needs pointing at a job outside this workflow invents no node", () => {
  const out = generateWorkflowDiagram(workflow([job("deploy", { needs: ["missing"] })]));
  const definition = out.definition as string;
  assertEqual(nodeIds(definition), ["job_1"], "only the real job");
  assertEqual(edges(definition), [], "dangling reference skipped");
});

// ── node content ─────────────────────────────────────────────────────────

test("a job node summarises runner and step count, not commands", () => {
  const lines = describeJob(
    job("build", { name: "Build", runsOn: "ubuntu-latest", stepCount: 3 })
  );
  assertEqual(lines, ["Build", "ubuntu-latest", "3 steps"], "compact summary");
  assertEqual(describeJob(job("a", { stepCount: 1 })), ["a", "1 step"], "singular");
});

test("a reusable-workflow job is labelled as such", () => {
  const lines = describeJob(job("deploy", { uses: "org/repo/.github/workflows/d.yml@main" }));
  assert(lines.includes("reusable workflow"), "labelled");
  assert(!lines.some((l) => l.includes("steps")), "no step count for a uses job");
});

test("a matrix job shows its combination count without expanding", () => {
  const lines = describeJob(
    job("test", {
      stepCount: 4,
      matrix: {
        dimensions: [
          { key: "node", values: ["18", "20", "22"] },
          { key: "os", values: ["ubuntu", "windows"] },
        ],
        hasInclude: false,
        hasExclude: false,
      },
    })
  );
  assert(lines.includes("matrix ×6"), `3x2 described, got ${JSON.stringify(lines)}`);
});

test("long commands never reach the graph", () => {
  const definition = definitionOf(
    workflow([
      job("build", {
        stepCount: 1,
        steps: [{ run: "x".repeat(1000), hasWith: false, hasEnv: false }],
      }),
    ])
  );
  assert(!definition.includes("xxxxxxxxxx"), "step text stays out of the diagram");
  assert(definition.length < 400, `diagram stays small, got ${definition.length}`);
});

// ── escaping and injection ───────────────────────────────────────────────

test("hostile workflow values cannot break out of a label", () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"] --> evil[" ',
    "<svg onload=alert(1)>",
    "back`tick",
    "pipe|char",
    "semi;colon",
    "brace{}",
    "bracket[]",
    "paren()",
    "arrow-->target",
    "flowchart TD",
    "a\nb",
    "back\\slash",
    "amp & hash #",
  ];

  const definition = definitionOf(
    workflow(hostile.map((name, i) => job(`j${i}`, { name })))
  );

  for (const line of definition.split("\n")) {
    const ok =
      line === "flowchart TD" ||
      /^ {2}job_\d+\["/.test(line) ||
      /^ {2}job_\d+ --> job_\d+$/.test(line);
    assert(ok, `no stray directive emitted: ${JSON.stringify(line)}`);
  }

  for (const line of definition.split("\n").filter((l) => l.includes('["'))) {
    const inner = /\["([^"]*)"\]/.exec(line)?.[1] ?? null;
    assert(inner !== null, `label closes exactly once: ${line}`);
    // The `<br/>` separators are ours; everything else must be escaped.
    const content = (inner ?? "").split("<br/>").join(" ");
    assert(!content.includes('"'), `no raw quote inside the label: ${line}`);
    assert(!content.includes("<"), `no raw angle bracket: ${line}`);
    assert(!content.includes(">"), `no raw angle bracket: ${line}`);
  }

  assertEqual(edges(definition), [], "no edge was injected by a label");
  assertEqual(nodeIds(definition).length, hostile.length, "no extra node injected");
});

test("newlines in a job name cannot inject a new statement", () => {
  const definition = definitionOf(
    workflow([job("a", { name: "evil\n  job_9[\"injected\"]" })])
  );
  assertEqual(nodeIds(definition).length, 1, "still one node");
  assert(!definition.includes("injected\"]"), "no injected node definition");
});

// ── limits and determinism ───────────────────────────────────────────────

test("the node guard trips at exactly the documented boundary", () => {
  const make = (count: number) =>
    workflow(Array.from({ length: count }, (_, i) => job(`j${String(i).padStart(4, "0")}`)));

  assertEqual(
    generateWorkflowDiagram(make(MAX_WORKFLOW_GRAPH_NODES)).exceededMaxNodes,
    false,
    "at the limit it still draws"
  );
  const over = generateWorkflowDiagram(make(MAX_WORKFLOW_GRAPH_NODES + 1));
  assertEqual(over.exceededMaxNodes, true, "one past the limit is refused");
  assertEqual(over.definition, null, "nothing generated");
  assertEqual(over.nodeCount, MAX_WORKFLOW_GRAPH_NODES + 1, "count reported honestly");
});

test("node ids are deterministic and map back to job ids", () => {
  const wf = workflow([job("alpha"), job("beta"), job("gamma")]);
  const out = generateWorkflowDiagram(wf);
  assertEqual(
    [...out.jobIdByNodeId.entries()],
    [["job_1", "alpha"], ["job_2", "beta"], ["job_3", "gamma"]],
    "sequential ids in job order"
  );
});

test("generation is deterministic across repeated calls", () => {
  const wf = workflow([job("b", { needs: ["a"] }), job("a"), job("c", { needs: ["a", "b"] })]);
  assertEqual(definitionOf(wf), definitionOf(wf), "identical output");
});

test("a large workflow stays within a bounded diagram size", () => {
  const jobs = Array.from({ length: 100 }, (_, i) =>
    job(`j${String(i).padStart(3, "0")}`, { runsOn: "ubuntu-latest", stepCount: 25 })
  );
  const out = generateWorkflowDiagram(workflow(jobs));
  assertEqual(out.exceededMaxNodes, false, "100 jobs still drawn");
  assertEqual(nodeIds(out.definition as string).length, 100, "one node per job, never per step");
});

await report("workflow Mermaid generation tests");
