/**
 * Tests for deterministic dependency-graph construction, including circular
 * dependencies, duplicate edges and partial analysis.
 *
 * Run with:  npx tsx src/parser/dependencyGraph.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { readAliases } from "./aliasConfig.js";
import { buildDependencyGraph } from "./dependencyGraph.js";
import { selectSourceFiles } from "../services/sourceService.js";

function graphOf(
  sources: Record<string, string>,
  extraFiles: string[] = [],
  options: { truncated?: boolean; filesSkipped?: number } = {}
) {
  return buildDependencyGraph({
    sources: new Map(Object.entries(sources)),
    repositoryFiles: new Set([...Object.keys(sources), ...extraFiles]),
    truncated: options.truncated ?? false,
    filesSkipped: options.filesSkipped ?? 0,
  });
}

// ── structure ────────────────────────────────────────────────────────────

test("a simple import produces two nodes and one directed edge", () => {
  const graph = graphOf({
    "src/App.tsx": 'import Header from "./components/Header";',
    "src/components/Header.tsx": "export default function Header() {}",
  });
  assertEqual(graph.nodes.map((n) => n.id), ["src/App.tsx", "src/components/Header.tsx"], "nodes");
  assertEqual(graph.edges.length, 1, "one edge");
  assertEqual(graph.edges[0].source, "src/App.tsx", "source imports");
  assertEqual(graph.edges[0].target, "src/components/Header.tsx", "target is imported");
  assertEqual(graph.edges[0].id, "src/App.tsx->src/components/Header.tsx", "edge id");
});

test("node ids and labels are derived from the path", () => {
  const graph = graphOf({ "src/deep/Thing.ts": "export const x = 1;" });
  assertEqual(graph.nodes[0].id, "src/deep/Thing.ts", "id is the path");
  assertEqual(graph.nodes[0].path, "src/deep/Thing.ts", "path");
  assertEqual(graph.nodes[0].label, "Thing.ts", "label is the basename");
  assertEqual(graph.nodes[0].type, "file", "type");
});

test("nodes and edges are sorted by id", () => {
  const graph = graphOf({
    "src/z.ts": 'import "./a";\nimport "./m";',
    "src/a.ts": "export const a = 1;",
    "src/m.ts": "export const m = 1;",
  });
  const nodeIds = graph.nodes.map((n) => n.id);
  assertEqual([...nodeIds].sort(), nodeIds, "nodes sorted");
  const edgeIds = graph.edges.map((e) => e.id);
  assertEqual([...edgeIds].sort(), edgeIds, "edges sorted");
});

test("the same input always produces the identical graph", () => {
  const sources = {
    "src/App.tsx": 'import a from "./a";\nimport b from "./b";',
    "src/a.ts": 'import "./b";',
    "src/b.ts": "export const b = 1;",
  };
  assertEqual(graphOf(sources), graphOf(sources), "deterministic");
});

test("duplicate imports of the same module collapse into one edge", () => {
  const graph = graphOf({
    "src/App.tsx": 'import "./foo";\nimport "./foo";\nconst f = require("./foo");',
    "src/foo.ts": "export const foo = 1;",
  });
  assertEqual(graph.edges.length, 1, "one edge only");
  assertEqual(graph.stats.internalDependencies, 1, "counted once in the graph");
  assertEqual(graph.stats.dependenciesFound, 3, "but all three specifiers were seen");
});

test("a file importing itself creates no self-edge", () => {
  const graph = graphOf({ "src/a.ts": 'import "./a";' });
  assertEqual(graph.edges.length, 0, "no self-edge");
  assertEqual(graph.nodes.length, 1, "still a node");
});

// ── classification ───────────────────────────────────────────────────────

test("internal, external and unresolved imports are counted separately", () => {
  const graph = graphOf({
    "src/App.tsx": [
      'import React from "react";',
      'import Header from "./Header";',
      'import missing from "./missing";',
    ].join("\n"),
    "src/Header.tsx": "export default function H() {}",
  });
  assertEqual(graph.stats.internalDependencies, 1, "one internal");
  assertEqual(graph.stats.externalImports, 1, "one external");
  assertEqual(graph.stats.unresolvedImports, 1, "one unresolved");
  assertEqual(graph.stats.dependenciesFound, 3, "three specifiers total");
});

test("external packages never become repository nodes", () => {
  const graph = graphOf({
    "src/App.tsx": 'import React from "react";\nimport axios from "axios";',
  });
  assertEqual(graph.nodes.map((n) => n.id), ["src/App.tsx"], "only the source file");
  assertEqual(graph.stats.externalPackages, 2, "distinct packages counted");
});

test("distinct external packages are counted once each", () => {
  const graph = graphOf({
    "a.ts": 'import "react";\nimport "react";',
    "b.ts": 'import "react";\nimport "axios";',
  });
  assertEqual(graph.stats.externalImports, 4, "four import statements");
  assertEqual(graph.stats.externalPackages, 2, "two distinct packages");
});

test("an imported file outside the analyzed set still becomes a node", () => {
  // Header.tsx exists in the repository but was not itself analyzed.
  const graph = graphOf(
    { "src/App.tsx": 'import "./Header";' },
    ["src/Header.tsx"]
  );
  assertEqual(graph.nodes.length, 2, "target added as a node");
  assertEqual(graph.stats.filesAnalyzed, 1, "but only one file was parsed");
});

test("an isolated file with no imports is still a node", () => {
  const graph = graphOf({ "src/lonely.ts": "export const x = 1;" });
  assertEqual(graph.nodes.map((n) => n.id), ["src/lonely.ts"], "present");
  assertEqual(graph.edges, [], "no edges");
});

// ── circular dependencies ────────────────────────────────────────────────

test("a two-file cycle produces two nodes and two directed edges", () => {
  const graph = graphOf({
    "src/A.ts": 'import "./B";',
    "src/B.ts": 'import "./A";',
  });
  assertEqual(graph.nodes.length, 2, "two nodes");
  assertEqual(graph.edges.map((e) => e.id), ["src/A.ts->src/B.ts", "src/B.ts->src/A.ts"], "both directions");
});

test("a longer cycle terminates and is fully represented", () => {
  const graph = graphOf({
    "a.ts": 'import "./b";',
    "b.ts": 'import "./c";',
    "c.ts": 'import "./a";',
  });
  assertEqual(graph.nodes.length, 3, "three nodes");
  assertEqual(graph.edges.length, 3, "three edges");
});

test("a large cycle does not blow the stack", () => {
  const sources: Record<string, string> = {};
  const size = 500;
  for (let i = 0; i < size; i++) {
    sources[`f${i}.ts`] = `import "./f${(i + 1) % size}";`;
  }
  const graph = graphOf(sources);
  assertEqual(graph.nodes.length, size, "every file is a node");
  assertEqual(graph.edges.length, size, "every link is an edge");
});

// ── robustness and partial analysis ──────────────────────────────────────

test("a malformed file is counted as failed but does not stop the rest", () => {
  const graph = graphOf({
    "src/broken.ts": "function ( { { ###",
    "src/good.ts": 'import "./other";',
    "src/other.ts": "export const x = 1;",
  });
  assert(graph.stats.filesAnalyzed >= 2, "the healthy files were analyzed");
  assertEqual(graph.edges.length, 1, "the good file's edge is present");
  assert(
    graph.nodes.some((n) => n.id === "src/broken.ts"),
    "the broken file remains a node"
  );
});

test("truncation and skipped counts are reported honestly", () => {
  const graph = graphOf({ "a.ts": "export const x = 1;" }, [], {
    truncated: true,
    filesSkipped: 42,
  });
  assertEqual(graph.stats.truncated, true, "flagged as partial");
  assertEqual(graph.stats.filesSkipped, 42, "skipped count preserved");
});

test("a complete analysis is not flagged as truncated", () => {
  const graph = graphOf({ "a.ts": "export const x = 1;" });
  assertEqual(graph.stats.truncated, false, "complete");
  assertEqual(graph.stats.filesSkipped, 0, "nothing skipped");
});

test("an empty source set produces an empty graph", () => {
  const graph = graphOf({});
  assertEqual(graph.nodes, [], "no nodes");
  assertEqual(graph.edges, [], "no edges");
  assertEqual(graph.stats.filesAnalyzed, 0, "nothing analyzed");
});

test("non-source files in the set are ignored", () => {
  const graph = graphOf({
    "README.md": "# not source",
    "a.ts": "export const x = 1;",
  });
  assertEqual(graph.nodes.map((n) => n.id), ["a.ts"], "only the source file");
});

// ── file selection limits ────────────────────────────────────────────────

test("file selection is deterministic and respects the limit", () => {
  const paths = ["z.ts", "a.ts", "m.ts", "b.ts"];
  const { selected, skipped } = selectSourceFiles(paths, 2);
  assertEqual(selected, ["a.ts", "b.ts"], "sorted, first N");
  assertEqual(skipped, 2, "remainder reported");
  assertEqual(selectSourceFiles(paths, 2).selected, selected, "stable across runs");
});

test("selection below the limit skips nothing", () => {
  const { selected, skipped } = selectSourceFiles(["a.ts", "b.ts"], 10);
  assertEqual(selected, ["a.ts", "b.ts"], "all selected");
  assertEqual(skipped, 0, "none skipped");
});

// ── aliases ──────────────────────────────────────────────────────────────

test("tsconfig path aliases are read when unambiguous", () => {
  const config = JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  });
  assertEqual([...readAliases("tsconfig.json", config)], [["@", "src"]], "mapping read");
});

test("tsconfig comments and trailing commas do not defeat alias reading", () => {
  const config = `{
    // a comment
    "compilerOptions": {
      /* block */
      "baseUrl": ".",
      "paths": { "@app/*": ["src/app/*"], },
    },
  }`;
  assertEqual([...readAliases("tsconfig.json", config)], [["@app", "src/app"]], "parsed");
});

test("ambiguous alias mappings are skipped rather than guessed", () => {
  const multiTarget = JSON.stringify({
    compilerOptions: { paths: { "@/*": ["src/*", "lib/*"] } },
  });
  assertEqual([...readAliases("tsconfig.json", multiTarget)], [], "several targets: skipped");

  const noWildcard = JSON.stringify({
    compilerOptions: { paths: { "@": ["src"] } },
  });
  assertEqual([...readAliases("tsconfig.json", noWildcard)], [], "no wildcard: skipped");
});

test("unreadable or aliasless configs yield nothing", () => {
  assertEqual([...readAliases("tsconfig.json", "{ not json")], [], "broken json");
  assertEqual([...readAliases("tsconfig.json", "{}")], [], "no compilerOptions");
});

test("aliases from a repository config are applied to the graph", () => {
  const graph = graphOf({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
    "src/App.tsx": 'import Header from "@/components/Header";',
    "src/components/Header.tsx": "export default function H() {}",
  });
  assertEqual(graph.edges.length, 1, "alias resolved to an edge");
  assertEqual(graph.edges[0].target, "src/components/Header.tsx", "correct target");
});

await report("dependency graph construction tests");
