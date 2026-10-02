/**
 * Tests for call graph traversal and default entry-point selection (Phase 6).
 *
 * Run with:  npx tsx src/parser/callGraphTraversal.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { buildCallGraphIndex } from "./callGraphBuilder.js";
import {
  selectDefaultEntryPoint,
  traverseCallGraph,
} from "./callGraphTraversal.js";

function graph(sources: Record<string, string>) {
  const map = new Map(Object.entries(sources));
  return buildCallGraphIndex({ sources: map, repositoryFiles: new Set(map.keys()) });
}

// ── traversal shapes ─────────────────────────────────────────────────────

test("linear chain", () => {
  const g = graph({
    "a.ts": "function a() { b(); }\nfunction b() { c(); }\nfunction c() {}",
  });
  const t = traverseCallGraph(g, "a.ts::a");
  assertEqual(t.nodes.map((n) => n.id), ["a.ts::a", "a.ts::b", "a.ts::c"], "all three, sorted");
  assertEqual(t.maxDepth, 2, "two hops deep");
  assertEqual(t.truncated, false, "not truncated");
});

test("branching", () => {
  const g = graph({
    "a.ts": "function main() { left(); right(); }\nfunction left() {}\nfunction right() {}",
  });
  const t = traverseCallGraph(g, "a.ts::main");
  assertEqual(
    t.nodes.map((n) => n.id),
    ["a.ts::left", "a.ts::main", "a.ts::right"],
    "both branches reached"
  );
  assertEqual(t.edges.length, 2, "two edges");
});

test("recursion (mutual)", () => {
  const g = graph({ "a.ts": "function a() { b(); }\nfunction b() { a(); }" });
  const t = traverseCallGraph(g, "a.ts::a");
  assertEqual(t.nodes.map((n) => n.id), ["a.ts::a", "a.ts::b"], "no duplicate nodes");
  assertEqual(t.edges.length, 2, "both directions of the cycle recorded");
});

test("self recursion", () => {
  const g = graph({ "a.ts": "function fac(n) { return n <= 1 ? 1 : n * fac(n - 1); }" });
  const t = traverseCallGraph(g, "a.ts::fac");
  assertEqual(t.nodes.length, 1, "exactly one node");
  assertEqual(t.edges.length, 1, "exactly one self-loop edge, not infinite");
});

test("cycle through three functions", () => {
  const g = graph({
    "a.ts": "function a() { b(); }\nfunction b() { c(); }\nfunction c() { a(); }",
  });
  const t = traverseCallGraph(g, "a.ts::a");
  assertEqual(t.nodes.length, 3, "three nodes, no duplicates");
  assertEqual(t.edges.length, 3, "the full cycle, not truncated");
});

test("disconnected functions are not included", () => {
  const g = graph({
    "a.ts": "function main() { helper(); }\nfunction helper() {}\nfunction unrelated() {}",
  });
  const t = traverseCallGraph(g, "a.ts::main");
  assert(!t.nodes.some((n) => n.id === "a.ts::unrelated"), "unreachable function excluded");
});

test("empty function (no calls) traverses to just itself", () => {
  const g = graph({ "a.ts": "function main() {}" });
  const t = traverseCallGraph(g, "a.ts::main");
  assertEqual(t.nodes.map((n) => n.id), ["a.ts::main"], "just the entry");
  assertEqual(t.edges, [], "no edges");
  assertEqual(t.maxDepth, 0, "depth zero");
});

test("no functions at all yields no default entry point", () => {
  const g = graph({ "a.ts": "const x = 1;" });
  assertEqual(selectDefaultEntryPoint(g), null, "nothing invented");
});

// ── limits ───────────────────────────────────────────────────────────────

test("max nodes truncates deterministically and flags the reason", () => {
  const lines = ["function e0() { e1(); }"];
  for (let i = 1; i < 10; i += 1) lines.push(`function e${i}() { e${i + 1}(); }`);
  lines.push("function e10() {}");
  const g = graph({ "a.ts": lines.join("\n") });

  const t = traverseCallGraph(g, "a.ts::e0", { maxNodes: 5, maxDepth: 100 });
  assertEqual(t.nodes.length, 5, "capped at the node limit");
  assertEqual(t.truncated, true, "flagged");
  assertEqual(t.truncationReason, "max_nodes", "reason given, never silent");
});

test("max depth truncates deterministically and flags the reason", () => {
  const lines = ["function e0() { e1(); }"];
  for (let i = 1; i < 10; i += 1) lines.push(`function e${i}() { e${i + 1}(); }`);
  lines.push("function e10() {}");
  const g = graph({ "a.ts": lines.join("\n") });

  const t = traverseCallGraph(g, "a.ts::e0", { maxNodes: 1000, maxDepth: 3 });
  assertEqual(t.maxDepth, 3, "did not exceed the depth limit");
  assertEqual(t.nodes.length, 4, "entry plus 3 levels");
  assertEqual(t.truncated, true, "flagged");
  assertEqual(t.truncationReason, "max_depth", "reason given, never silent");
});

test("an entry point with no such function yields an empty result, not a crash", () => {
  const g = graph({ "a.ts": "function main() {}" });
  const t = traverseCallGraph(g, "a.ts::doesNotExist");
  assertEqual(t.nodes, [], "empty");
  assertEqual(t.edges, [], "empty");
});

// ── default entry point selection ───────────────────────────────────────

test("an exported main is preferred over everything else", () => {
  const g = graph({
    "a.ts": "export default function App() {}\nexport function main() {}",
  });
  assertEqual(selectDefaultEntryPoint(g), "a.ts::main", "main wins over the default export");
});

test("any main is preferred over a default export when none is exported", () => {
  const g = graph({
    "a.ts": "export default function App() {}\nfunction main() {}",
  });
  assertEqual(selectDefaultEntryPoint(g), "a.ts::main", "unexported main still wins");
});

test("a default export is used when there is no main", () => {
  const g = graph({ "a.ts": "export default function App() {}\nfunction helper() {}" });
  assertEqual(selectDefaultEntryPoint(g), "a.ts::App", "default export chosen");
});

test("falls back to the first function by sorted id", () => {
  const g = graph({ "b.ts": "function zeta() {}", "a.ts": "function alpha() {}" });
  assertEqual(selectDefaultEntryPoint(g), "a.ts::alpha", "deterministic, sorted-first");
});

// ── determinism ──────────────────────────────────────────────────────────

test("traversal is deterministic across repeated runs", () => {
  const g = graph({
    "a.ts": "function main() { b(); c(); }\nfunction b() { d(); }\nfunction c() { d(); }\nfunction d() {}",
  });
  const t1 = traverseCallGraph(g, "a.ts::main");
  const t2 = traverseCallGraph(g, "a.ts::main");
  assertEqual(t1.nodes.map((n) => n.id), t2.nodes.map((n) => n.id), "same nodes, same order");
  assertEqual(
    t1.edges.map((e) => `${e.source}->${e.target}`),
    t2.edges.map((e) => `${e.source}->${e.target}`),
    "same edges, same order"
  );
});

await report("Call graph traversal tests");
