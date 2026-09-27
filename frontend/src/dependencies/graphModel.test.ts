/**
 * Tests for dependency-graph layout, filtering and neighbour lookup.
 *
 * Run with:  npx tsx src/dependencies/graphModel.test.ts
 */
import type { DependencyEdge, DependencyNode } from "../types/dependencies";
import { assert, assertEqual, report, test } from "../utils/testHarness";
import {
  MAX_DEPENDENCY_GRAPH_NODES,
  filterGraph,
  layoutGraph,
  neighboursOf,
  topLevelDirectories,
} from "./graphModel";

const node = (path: string): DependencyNode => ({
  id: path,
  path,
  label: path.slice(path.lastIndexOf("/") + 1),
  type: "file",
});

const edge = (source: string, target: string): DependencyEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "internal",
});

// ── layout ───────────────────────────────────────────────────────────────

test("every node receives a position", () => {
  const nodes = [node("a.ts"), node("b.ts"), node("c.ts")];
  const placed = layoutGraph(nodes, [edge("a.ts", "b.ts")]);
  assertEqual(placed.length, 3, "all nodes placed");
  for (const p of placed) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), `finite position for ${p.node.id}`);
  }
});

test("no two nodes share a position", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((n) => node(`${n}.ts`));
  const placed = layoutGraph(nodes, [edge("a.ts", "b.ts"), edge("a.ts", "c.ts")]);
  const seen = new Set(placed.map((p) => `${p.x},${p.y}`));
  assertEqual(seen.size, placed.length, "positions are distinct");
});

test("nodes are not all stacked at the origin", () => {
  const nodes = ["a", "b", "c"].map((n) => node(`${n}.ts`));
  const placed = layoutGraph(nodes, []);
  const atOrigin = placed.filter((p) => p.x === 0 && p.y === 0);
  assertEqual(atOrigin.length, 1, "at most one node sits at (0,0)");
});

test("an imported file is laid out to the right of its importer", () => {
  const nodes = [node("a.ts"), node("b.ts"), node("c.ts")];
  const placed = layoutGraph(nodes, [edge("a.ts", "b.ts"), edge("b.ts", "c.ts")]);
  const x = new Map(placed.map((p) => [p.node.id, p.x]));
  assert((x.get("a.ts") ?? 0) < (x.get("b.ts") ?? 0), "a before b");
  assert((x.get("b.ts") ?? 0) < (x.get("c.ts") ?? 0), "b before c");
});

test("layout is deterministic", () => {
  const nodes = ["z", "a", "m"].map((n) => node(`${n}.ts`));
  const edges = [edge("a.ts", "m.ts"), edge("m.ts", "z.ts")];
  assertEqual(layoutGraph(nodes, edges), layoutGraph(nodes, edges), "identical output");
});

test("input order does not change the layout", () => {
  const edges = [edge("a.ts", "b.ts")];
  const forward = layoutGraph([node("a.ts"), node("b.ts")], edges);
  const reversed = layoutGraph([node("b.ts"), node("a.ts")], edges);
  assertEqual(forward, reversed, "order-independent");
});

test("a dependency cycle lays out without hanging", () => {
  const nodes = [node("a.ts"), node("b.ts")];
  const placed = layoutGraph(nodes, [edge("a.ts", "b.ts"), edge("b.ts", "a.ts")]);
  assertEqual(placed.length, 2, "both placed");
});

test("a large cycle terminates", () => {
  const size = 300;
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  for (let i = 0; i < size; i++) {
    nodes.push(node(`f${i}.ts`));
    edges.push(edge(`f${i}.ts`, `f${(i + 1) % size}.ts`));
  }
  assertEqual(layoutGraph(nodes, edges).length, size, "all placed, no hang");
});

test("edges referencing missing nodes are ignored by the layout", () => {
  const placed = layoutGraph([node("a.ts")], [edge("a.ts", "ghost.ts")]);
  assertEqual(placed.length, 1, "only the real node");
});

test("an empty graph lays out to nothing", () => {
  assertEqual(layoutGraph([], []), [], "empty");
});

// ── neighbours ───────────────────────────────────────────────────────────

test("neighbours separate dependencies from dependents", () => {
  const edges = [
    edge("app.ts", "header.ts"),
    edge("app.ts", "api.ts"),
    edge("main.ts", "app.ts"),
  ];
  const result = neighboursOf("app.ts", edges);
  assertEqual(result.dependencies, ["api.ts", "header.ts"], "imports, sorted");
  assertEqual(result.dependents, ["main.ts"], "imported by");
});

test("an isolated file has no neighbours", () => {
  assertEqual(
    neighboursOf("lonely.ts", [edge("a.ts", "b.ts")]),
    { dependencies: [], dependents: [] },
    "none"
  );
});

test("a cycle reports each direction once", () => {
  const edges = [edge("a.ts", "b.ts"), edge("b.ts", "a.ts")];
  const result = neighboursOf("a.ts", edges);
  assertEqual(result.dependencies, ["b.ts"], "imports b");
  assertEqual(result.dependents, ["b.ts"], "imported by b");
});

// ── filtering ────────────────────────────────────────────────────────────

const NODES = [
  node("src/App.tsx"),
  node("src/components/Header.tsx"),
  node("src/components/Footer.tsx"),
  node("src/services/api.ts"),
  node("tests/App.test.ts"),
];
const EDGES = [
  edge("src/App.tsx", "src/components/Header.tsx"),
  edge("src/App.tsx", "src/services/api.ts"),
  edge("tests/App.test.ts", "src/App.tsx"),
];

test("an empty search keeps everything", () => {
  const result = filterGraph(NODES, EDGES, { search: "" });
  assertEqual(result.nodes.length, NODES.length, "all nodes");
  assertEqual(result.edges.length, EDGES.length, "all edges");
});

test("search matches any part of the path", () => {
  const result = filterGraph(NODES, EDGES, { search: "components" });
  assertEqual(
    result.nodes.map((n) => n.id),
    ["src/components/Header.tsx", "src/components/Footer.tsx"],
    "directory filter"
  );
});

test("search is case-insensitive and trimmed", () => {
  const result = filterGraph(NODES, EDGES, { search: "  HEADER  " });
  assertEqual(result.nodes.map((n) => n.id), ["src/components/Header.tsx"], "matched");
});

test("edges with a filtered-out endpoint are dropped", () => {
  const result = filterGraph(NODES, EDGES, { search: "src/components" });
  assertEqual(result.edges, [], "no dangling edges");
  for (const e of result.edges) {
    assert(
      result.nodes.some((n) => n.id === e.source) &&
        result.nodes.some((n) => n.id === e.target),
      "both endpoints present"
    );
  }
});

test("a filter matching nothing yields an empty graph", () => {
  const result = filterGraph(NODES, EDGES, { search: "nonexistent" });
  assertEqual(result.nodes, [], "no nodes");
  assertEqual(result.edges, [], "no edges");
});

test("focus keeps a file and its direct neighbourhood only", () => {
  const result = filterGraph(NODES, EDGES, { search: "", focusId: "src/App.tsx" });
  assertEqual(
    result.nodes.map((n) => n.id).sort(),
    ["src/App.tsx", "src/components/Header.tsx", "src/services/api.ts", "tests/App.test.ts"],
    "self, dependencies and dependents"
  );
  assert(
    !result.nodes.some((n) => n.id === "src/components/Footer.tsx"),
    "unrelated file excluded"
  );
});

test("focus always includes the focused file itself", () => {
  const result = filterGraph(NODES, EDGES, {
    search: "nonexistent",
    focusId: "src/App.tsx",
  });
  assertEqual(result.nodes.map((n) => n.id), ["src/App.tsx"], "focus survives a strict search");
});

test("filtering is deterministic", () => {
  const options = { search: "src", focusId: null };
  assertEqual(
    filterGraph(NODES, EDGES, options),
    filterGraph(NODES, EDGES, options),
    "same result"
  );
});

test("filtering preserves the sorted order of the input", () => {
  const result = filterGraph(NODES, EDGES, { search: "src" });
  const ids = result.nodes.map((n) => n.id);
  assertEqual(ids, NODES.filter((n) => n.path.includes("src")).map((n) => n.id), "order kept");
});

// ── directories and limits ───────────────────────────────────────────────

test("top-level directories are listed once and sorted", () => {
  assertEqual(topLevelDirectories(NODES), ["src", "tests"], "distinct, sorted");
});

test("root-level files contribute no directory", () => {
  assertEqual(topLevelDirectories([node("README.ts")]), [], "none");
});

test("the graph size limit is a sane positive number", () => {
  assert(MAX_DEPENDENCY_GRAPH_NODES > 0, "positive");
  assert(MAX_DEPENDENCY_GRAPH_NODES <= 500, "small enough to render smoothly");
});

await report("dependency graph model tests");
