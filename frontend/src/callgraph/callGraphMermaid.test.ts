/**
 * Tests for call graph Mermaid sequence-diagram generation: determinism,
 * escaping and injection resistance.
 *
 * Run with:  npx tsx src/callgraph/callGraphMermaid.test.ts
 */
import type { CallGraphEdge, CallGraphFunctionNode } from "../types/callGraph";
import { assert, assertEqual, report, test } from "../utils/testHarness";
import { MAX_CALL_FLOW_DIAGRAM_NODES, generateCallGraphDiagram } from "./callGraphMermaid";

function node(id: string, extra: Partial<CallGraphFunctionNode> = {}): CallGraphFunctionNode {
  return {
    id,
    file: extra.file ?? "a.ts",
    name: extra.name ?? id,
    displayName: extra.displayName ?? id,
    startLine: extra.startLine ?? 1,
    endLine: extra.endLine ?? 1,
    kind: extra.kind ?? "function-declaration",
    exported: extra.exported ?? false,
  };
}

function edge(source: string, target: string, extra: Partial<CallGraphEdge> = {}): CallGraphEdge {
  return {
    source,
    target,
    callExpression: extra.callExpression ?? `${target}()`,
    line: extra.line ?? 1,
    callCount: extra.callCount ?? 1,
  };
}

function participants(definition: string): string[] {
  return definition
    .split("\n")
    .filter((l) => l.trim().startsWith("participant"))
    .map((l) => l.trim());
}

function messages(definition: string): string[] {
  return definition
    .split("\n")
    .filter((l) => l.includes("->>"))
    .map((l) => l.trim());
}

// ── shapes ───────────────────────────────────────────────────────────────

test("no nodes produces no diagram", () => {
  const out = generateCallGraphDiagram([], []);
  assertEqual(out.definition, null, "nothing to draw");
  assertEqual(out.nodeCount, 0, "no functions");
  assertEqual(out.exceededMaxNodes, false, "not a limit problem");
});

test("a single function with no calls produces one participant and no messages", () => {
  const out = generateCallGraphDiagram([node("a")], []);
  assert(out.definition !== null, "diagram produced");
  assert(out.definition!.startsWith("sequenceDiagram"), "sequence diagram header");
  assertEqual(participants(out.definition as string).length, 1, "one participant");
  assertEqual(messages(out.definition as string), [], "no messages");
});

test("a linear chain produces one message per edge", () => {
  const nodes = [node("main"), node("authenticate"), node("loadUser")];
  const edges = [edge("main", "authenticate"), edge("authenticate", "loadUser")];
  const out = generateCallGraphDiagram(nodes, edges);
  assertEqual(messages(out.definition as string).length, 2, "two messages");
});

test("participant ids are sequential, never derived from source text", () => {
  const out = generateCallGraphDiagram([node("weird\"];x[\"name")], []);
  const ps = participants(out.definition as string);
  assert(ps[0].startsWith("participant function_1"), "sequential id");
});

test("repeated calls to the same target are annotated with a count", () => {
  const nodes = [node("main"), node("b")];
  const edges = [edge("main", "b", { callCount: 3, callExpression: "b()" })];
  const out = generateCallGraphDiagram(nodes, edges);
  assert((out.definition as string).includes("×3"), "call count shown");
});

test("a self-loop (recursion) renders as a message to the same participant", () => {
  const nodes = [node("factorial")];
  const edges = [edge("factorial", "factorial", { callExpression: "factorial(n - 1)" })];
  const out = generateCallGraphDiagram(nodes, edges);
  assert(messages(out.definition as string)[0].startsWith("function_1->>function_1:"), "self message");
});

test("a cycle (a <-> b) renders both directions without looping the generator", () => {
  const nodes = [node("a"), node("b")];
  const edges = [edge("a", "b"), edge("b", "a")];
  const out = generateCallGraphDiagram(nodes, edges);
  assertEqual(messages(out.definition as string).length, 2, "both edges present");
});

test("exceeding the node limit produces no diagram and flags the reason", () => {
  const nodes = Array.from({ length: MAX_CALL_FLOW_DIAGRAM_NODES + 1 }, (_, i) => node(`f${i}`));
  const out = generateCallGraphDiagram(nodes, []);
  assertEqual(out.definition, null, "nothing drawn");
  assertEqual(out.exceededMaxNodes, true, "flagged");
  assertEqual(out.nodeCount, MAX_CALL_FLOW_DIAGRAM_NODES + 1, "actual count reported");
});

// ── escaping / injection resistance ─────────────────────────────────────

test("a Mermaid-breaking name is escaped, not interpreted", () => {
  const malicious = node("x", { displayName: '"; sequenceDiagram\nactor Evil' });
  const out = generateCallGraphDiagram([malicious], []);
  const definition = out.definition as string;
  assert(!definition.includes('as "";'), "quote cannot break out of the label");
  assert(!/\nactor Evil/.test(definition), "no injected directive");
});

test("HTML-like content in a call expression is escaped", () => {
  const nodes = [node("main"), node("b")];
  const edges = [edge("main", "b", { callExpression: '<img src=x onerror=alert(1)>' })];
  const out = generateCallGraphDiagram(nodes, edges);
  const definition = out.definition as string;
  assert(!definition.includes("<img"), "raw HTML never appears");
  assert(definition.includes("#lt;img"), "escaped via the shared entity-code scheme");
});

test("ampersands and quotes in function names are escaped", () => {
  const nodes = [node("x", { displayName: 'A & "B"' })];
  const out = generateCallGraphDiagram(nodes, []);
  const definition = out.definition as string;
  assert(definition.includes("#amp;"), "ampersand escaped");
  assert(definition.includes("#quot;"), "quote escaped");
});

// ── determinism ──────────────────────────────────────────────────────────

test("diagram generation is deterministic", () => {
  const nodes = [node("main"), node("b"), node("c")];
  const edges = [edge("main", "b"), edge("main", "c")];
  const first = generateCallGraphDiagram(nodes, edges).definition;
  const second = generateCallGraphDiagram(nodes, edges).definition;
  assertEqual(first, second, "same input, same output");
});

await report("Call graph Mermaid generation tests");
