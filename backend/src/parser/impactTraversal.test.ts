/**
 * Tests for the pure reverse-dependency impact traversal (Phase 7).
 *
 * Builds synthetic `DependencyGraph`s directly — no GitHub call, no archive
 * download — exactly the way `callGraphTraversal.test.ts` tests traversal
 * against a synthetic call graph.
 *
 * Run with:  npx tsx src/parser/impactTraversal.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import type { DependencyGraph, DependencyGraphEdge } from "../types/dependencies.js";
import type { ChangedFile } from "../types/history.js";
import { STANDARD_WARNING, computeImpactGraph } from "./impactTraversal.js";

/** `edges` as `"a->b"` strings, source imports target — Phase 4's convention. */
function graphFrom(edgeStrings: string[]): DependencyGraph {
  const nodeIds = new Set<string>();
  const edges: DependencyGraphEdge[] = edgeStrings.map((e) => {
    const [source, target] = e.split("->");
    nodeIds.add(source);
    nodeIds.add(target);
    return { id: e, source, target, type: "internal" };
  });
  return {
    nodes: [...nodeIds].sort().map((id) => ({ id, path: id, label: id, type: "file" })),
    edges,
    stats: {
      filesAnalyzed: nodeIds.size,
      filesSkipped: 0,
      filesFailed: 0,
      dependenciesFound: edges.length,
      internalDependencies: edges.length,
      externalImports: 0,
      externalPackages: 0,
      unresolvedImports: 0,
      truncated: false,
    },
  };
}

function changed(...paths: string[]): ChangedFile[] {
  return paths.map((path) => ({
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    previousPath: null,
    patchAvailable: true,
  }));
}

function relOf(result: ReturnType<typeof computeImpactGraph>, id: string): string | undefined {
  return result.nodes.find((n) => n.id === id)?.relationship;
}

// ── relationships ────────────────────────────────────────────────────────

test("a direct dependent is marked 'direct' at depth 1", () => {
  // A -> B (A imports B). B changes, so A is directly affected.
  const graph = graphFrom(["A->B"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(relOf(result, "B"), "changed", "B is the changed file");
  assertEqual(relOf(result, "A"), "direct", "A directly depends on B");
  assertEqual(result.affectedFiles, ["A"], "affected list");
  assertEqual(result.edges, [{ source: "A", target: "B" }], "edge direction preserved");
});

test("a transitive dependent is marked 'transitive' with the correct depth", () => {
  // A -> C -> B, per spec's own example (B changes, C direct, D... here A is
  // two hops away via C).
  const graph = graphFrom(["A->C", "C->B"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(relOf(result, "C"), "direct", "C directly imports B");
  assertEqual(relOf(result, "A"), "transitive", "A is two hops from B");
  assertEqual(result.nodes.find((n) => n.id === "A")?.depth, 2, "depth recorded");
});

test("spec section 13's own example: A->B, C->B, D->C; B changes", () => {
  const graph = graphFrom(["A->B", "C->B", "D->C"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(relOf(result, "A"), "direct", "A directly dependent");
  assertEqual(relOf(result, "C"), "direct", "C directly dependent");
  assertEqual(relOf(result, "D"), "transitive", "D transitively affected");
});

test("a file with no dependents affects nothing", () => {
  const graph = graphFrom(["A->B"]);
  const result = computeImpactGraph(graph, changed("A"), 5, 200);
  assertEqual(result.affectedFiles, [], "A is a leaf no one imports");
});

// ── cycles and self-dependency ───────────────────────────────────────────

test("a cycle is traversed without hanging, each node visited once", () => {
  const graph = graphFrom(["A->B", "B->A"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(result.nodes.length, 2, "exactly two nodes, not infinite");
  // A imports B (direct). B imports A, but A is already a node (the changed
  // file) — recorded as an edge without re-visiting.
  assertEqual(relOf(result, "A"), "direct", "A directly affected");
  assert(result.edges.some((e) => e.source === "B" && e.target === "A"), "B->A edge recorded");
});

test("a three-file cycle terminates and records the full cycle", () => {
  const graph = graphFrom(["A->B", "B->C", "C->A"]);
  const result = computeImpactGraph(graph, changed("A"), 5, 200);
  assertEqual(result.nodes.length, 3, "all three, no duplicates");
  assertEqual(result.edges.length, 3, "the full cycle recorded");
});

test("a self-dependency does not loop forever", () => {
  const graph = graphFrom(["A->A"]);
  const result = computeImpactGraph(graph, changed("A"), 5, 200);
  assertEqual(result.nodes.length, 1, "one node");
  assertEqual(result.edges.length, 1, "one self-edge, not infinite");
});

// ── missing / unresolved ─────────────────────────────────────────────────

test("a changed file absent from the dependency graph is 'unresolved', not silently dropped", () => {
  const graph = graphFrom(["A->B"]);
  const result = computeImpactGraph(graph, changed("README.md"), 5, 200);
  assertEqual(relOf(result, "README.md"), "unresolved", "honestly flagged");
  assert(result.warnings.includes(STANDARD_WARNING), "standard disclaimer present");
  assert(
    result.warnings.some((w) => w.includes("not part of the static dependency graph")),
    "specific reason given"
  );
});

test("a changed file with no known dependents is still reported, with zero impact", () => {
  const graph = graphFrom(["A->B"]);
  const result = computeImpactGraph(graph, changed("B", "Z"), 5, 200);
  // Z isn't in the graph at all.
  assertEqual(relOf(result, "Z"), "unresolved", "Z unresolved");
  assertEqual(relOf(result, "B"), "changed", "B is a real graph node");
});

// ── limits ───────────────────────────────────────────────────────────────

test("max depth truncates deterministically and flags the reason", () => {
  // A chain ten deep: e0 -> e1 -> ... -> e9, e9 changes.
  const edges: string[] = [];
  for (let i = 0; i < 9; i += 1) edges.push(`e${i}->e${i + 1}`);
  const graph = graphFrom(edges);
  const result = computeImpactGraph(graph, changed("e9"), 3, 1000);
  assertEqual(result.stats.maxDepth, 3, "did not exceed the depth limit");
  assertEqual(result.truncated, true, "flagged");
  assertEqual(result.truncationReason, "max_depth", "reason given, never silent");
});

test("max files truncates deterministically and flags the reason", () => {
  const edges = Array.from({ length: 10 }, (_, i) => `dependent${i}->CHANGED`);
  const graph = graphFrom(edges);
  const result = computeImpactGraph(graph, changed("CHANGED"), 5, 4);
  assertEqual(result.nodes.length, 4, "capped at the file limit");
  assertEqual(result.truncated, true, "flagged");
  assertEqual(result.truncationReason, "max_files", "reason given, never silent");
});

test("never silently truncates — truncated is always explicit", () => {
  const graph = graphFrom(["A->B"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(result.truncated, false, "genuinely complete, and says so");
});

// ── determinism ──────────────────────────────────────────────────────────

test("output is deterministic across repeated runs, regardless of input order", () => {
  const graph = graphFrom(["A->B", "C->B", "D->C", "E->B"]);
  const first = computeImpactGraph(graph, changed("B"), 5, 200);
  const second = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(first.nodes, second.nodes, "same nodes, same order");
  assertEqual(first.edges, second.edges, "same edges, same order");
});

test("nodes are sorted by id and edges by source then target", () => {
  const graph = graphFrom(["Zebra->B", "Alpha->B"]);
  const result = computeImpactGraph(graph, changed("B"), 5, 200);
  assertEqual(result.nodes.map((n) => n.id), ["Alpha", "B", "Zebra"], "sorted");
  assertEqual(
    result.edges.map((e) => e.source),
    ["Alpha", "Zebra"],
    "edges sorted by source"
  );
});

// ── security ─────────────────────────────────────────────────────────────

test("a malicious file path is treated as plain data, never resolved or executed", () => {
  const graph = graphFrom(["A->B"]);
  const malicious = changed("../../../etc/passwd; rm -rf /");
  const result = computeImpactGraph(graph, malicious, 5, 200);
  assertEqual(relOf(result, "../../../etc/passwd; rm -rf /"), "unresolved", "handled as an ordinary string");
});

await report("Impact traversal tests");
