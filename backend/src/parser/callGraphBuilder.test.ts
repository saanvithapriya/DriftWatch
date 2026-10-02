/**
 * Tests for cross-file static call resolution (Phase 6).
 *
 * Run with:  npx tsx src/parser/callGraphBuilder.test.ts
 */
import { assertEqual, report, test } from "../testHarness.js";
import { buildCallGraphIndex } from "./callGraphBuilder.js";

function graph(sources: Record<string, string>) {
  const map = new Map(Object.entries(sources));
  return buildCallGraphIndex({ sources: map, repositoryFiles: new Set(map.keys()) });
}

function edgesFrom(index: ReturnType<typeof graph>, source: string): string[] {
  return (index.adjacency.get(source) ?? []).map((e) => e.target);
}

// ── resolution priorities ────────────────────────────────────────────────

test("same-file function", () => {
  const g = graph({ "a.ts": "function main() { helper(); }\nfunction helper() {}" });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::helper"], "resolved");
  assertEqual(g.unresolvedCalls, 0, "no unresolved calls");
});

test("same-file function binding (const bound to an arrow)", () => {
  const g = graph({ "a.ts": "const foo = () => {};\nfunction main() { foo(); }" });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::foo"], "resolved via the binding");
});

test("named import", () => {
  const g = graph({
    "b.ts": 'import { calculateTotal } from "./utils";\nexport function createOrder() { calculateTotal(); }',
    "utils.ts": "export function calculateTotal() {}",
  });
  assertEqual(edgesFrom(g, "b.ts::createOrder"), ["utils.ts::calculateTotal"], "resolved across files");
});

test("aliased named import", () => {
  const g = graph({
    "b.ts": 'import { calculateTotal as ct } from "./utils";\nfunction main() { ct(); }',
    "utils.ts": "export function calculateTotal() {}",
  });
  assertEqual(edgesFrom(g, "b.ts::main"), ["utils.ts::calculateTotal"], "resolved through the alias");
});

test("default import", () => {
  const g = graph({
    "b.ts": 'import App from "./app";\nfunction main() { App(); }',
    "app.ts": "export default function App() {}",
  });
  assertEqual(edgesFrom(g, "b.ts::main"), ["app.ts::App"], "resolved to the default export");
});

test("namespace import", () => {
  const g = graph({
    "b.ts": 'import * as utils from "./utils";\nfunction main() { utils.calculateTotal(); }',
    "utils.ts": "export function calculateTotal() {}",
  });
  assertEqual(edgesFrom(g, "b.ts::main"), ["utils.ts::calculateTotal"], "resolved via the namespace");
});

test("re-export (one hop)", () => {
  const g = graph({
    "reexport.ts": 'export { calculateTotal as total } from "./utils";',
    "utils.ts": "export function calculateTotal() {}",
    "user.ts": 'import { total } from "./reexport";\nfunction main() { total(); }',
  });
  assertEqual(edgesFrom(g, "user.ts::main"), ["utils.ts::calculateTotal"], "resolved through the re-export");
});

test("class method resolved via this", () => {
  const g = graph({
    "a.ts": "class Order { create() { this.total(); } total() {} }",
  });
  assertEqual(edgesFrom(g, "a.ts::Order.create"), ["a.ts::Order.total"], "resolved via the class");
});

test("object method resolved statically", () => {
  const g = graph({
    "a.ts": "const svc = { total() {} };\nfunction main() { svc.total(); }",
  });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::svc.total"], "resolved");
});

test("new ClassName() resolves to the constructor", () => {
  const g = graph({
    "a.ts": "class Widget { constructor() {} }\nfunction main() { new Widget(); }",
  });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::Widget.constructor"], "resolved");
});

// ── unresolved and external ─────────────────────────────────────────────

test("a dynamic call is never guessed at", () => {
  const g = graph({
    "a.ts": "function main() { const fn = getHandler(); fn(); }\nfunction getHandler() {}",
  });
  // `getHandler()` resolves; `fn()` does not, since `fn` is bound to a call
  // result, not to a function value.
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::getHandler"], "only the real call resolved");
  assertEqual(g.unresolvedCalls, 1, "fn() counted as unresolved");
});

test("a computed member call is never guessed at", () => {
  const g = graph({ "a.ts": "function main() { obj[dynamicName](); }" });
  assertEqual(g.unresolvedCalls, 1, "unresolved, not fabricated");
  assertEqual(edgesFrom(g, "a.ts::main"), [], "no invented edge");
});

test("an external package call is classified as external, not internal", () => {
  const g = graph({
    "a.ts": 'import axios from "axios";\nfunction main() { axios.get("/x"); }',
  });
  assertEqual(edgesFrom(g, "a.ts::main"), [], "no internal edge fabricated");
  assertEqual(g.externalCalls, 1, "counted as external");
  assertEqual(g.unresolvedCalls, 0, "not double-counted as unresolved");
});

test("a well-known global call (console.log) is not treated as an internal function", () => {
  const g = graph({ "a.ts": "function main() { console.log('x'); }" });
  assertEqual(edgesFrom(g, "a.ts::main"), [], "never fabricated");
});

test("a callback reference that does not resolve is silently dropped", () => {
  // `run` is a same-file function, so the direct call resolves cleanly; the
  // interesting part is the callback-heuristic reference to `doesNotExist`,
  // which is bound nowhere and must not be counted as a finding at all.
  const g = graph({
    "a.ts": "function main() { run(doesNotExist); }\nfunction run(fn) {}",
  });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::run"], "the direct call still resolves");
  assertEqual(g.unresolvedCalls, 0, "the dangling callback reference is not counted");
  assertEqual(g.externalCalls, 0, "not counted either");
});

test("a callback reference that does resolve becomes an edge", () => {
  const g = graph({
    "a.ts": "function main() { items.map(transform); }\nfunction transform() {}",
  });
  assertEqual(edgesFrom(g, "a.ts::main"), ["a.ts::transform"], "resolved");
});

// ── edge de-duplication ──────────────────────────────────────────────────

test("repeated calls to the same target collapse into one edge with a call count", () => {
  const g = graph({ "a.ts": "function main() { b(); b(); }\nfunction b() {}" });
  const edges = g.adjacency.get("a.ts::main") ?? [];
  assertEqual(edges.length, 1, "one edge");
  assertEqual(edges[0].callCount, 2, "counted");
});

// ── determinism ──────────────────────────────────────────────────────────

test("graph construction is deterministic", () => {
  const sources = {
    "a.ts": "function main() { b(); c(); }\nfunction b() {}\nfunction c() {}",
  };
  const g1 = graph(sources);
  const g2 = graph(sources);
  assertEqual(
    g1.allFunctions.map((f) => f.id),
    g2.allFunctions.map((f) => f.id),
    "same function order"
  );
  assertEqual(edgesFrom(g1, "a.ts::main"), edgesFrom(g2, "a.ts::main"), "same edge order");
});

await report("Cross-file call resolution tests");
