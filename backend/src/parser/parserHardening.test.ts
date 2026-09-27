/**
 * Adversarial parser tests: modern syntax, hostile source, size boundaries
 * and determinism under reordered input.
 *
 * Run with:  npx tsx src/parser/parserHardening.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { analyzeSourceFile } from "./dependencyExtractor.js";
import { buildDependencyGraph } from "./dependencyGraph.js";

function specifiers(source: string, path = "a.tsx"): string[] {
  return analyzeSourceFile(path, source).imports.map((i) => i.specifier).sort();
}

// ── imports are read from the AST, not by scanning text ──────────────────

test("a template literal containing import syntax is not a dependency", () => {
  const source = 'const s = `import evil from "./evil"`;\nimport real from "./real";';
  assertEqual(specifiers(source), ["./real"], "only the real import");
});

test("a string containing require syntax is not a dependency", () => {
  const source = `const s = 'require("./fake")';\nconst r = require("./real");`;
  assertEqual(specifiers(source), ["./real"], "only the real require");
});

test("commented-out imports are not dependencies", () => {
  const source = [
    '// import fake from "./fake";',
    '/* import block from "./block"; */',
    'import real from "./real";',
  ].join("\n");
  assertEqual(specifiers(source), ["./real"], "comments ignored");
});

test("a non-literal specifier is never guessed at", () => {
  assertEqual(specifiers('const n = "./x";\nconst m = require(n);'), [], "variable require");
  assertEqual(specifiers("const m = require(`./tpl`);"), [], "template literal require");
  assertEqual(specifiers('const m = import("./a" + suffix);'), [], "concatenated dynamic import");
});

// ── modern syntax must not defeat extraction ─────────────────────────────

test("modern JavaScript and TypeScript syntax still yields imports", () => {
  const cases: Array<[string, string]> = [
    ["decorators", '@dec class A {}\nimport x from "./x";'],
    ["private fields", 'class A { #p = 1; }\nimport x from "./x";'],
    ["optional chaining", 'const a = b?.c ?? d;\nimport x from "./x";'],
    ["async generators", 'async function* g() { yield 1; }\nimport x from "./x";'],
    ["satisfies", 'const a = {} satisfies Record<string, number>;\nimport x from "./x";'],
    ["generic arrow in TSX", 'const f = <T,>(v: T) => v;\nimport x from "./x";'],
    ["import.meta", 'const u = import.meta.url;\nimport x from "./x";'],
    ["top-level await import", 'const m = await import("./x");'],
    ["import attributes", 'import x from "./x" with { type: "json" };'],
    ["export default from", 'export { default } from "./x";'],
    ["multiline import", 'import {\n  a,\n  b,\n} from "./x";'],
    ["type-only default", 'import type x from "./x";'],
    ["namespace re-export", 'export * as ns from "./x";'],
  ];
  for (const [label, source] of cases) {
    assertEqual(specifiers(source), ["./x"], label);
  }
});

test("unicode, CRLF and a byte-order mark do not break extraction", () => {
  assertEqual(specifiers('import x from "./café/日本語";'), ["./café/日本語"], "unicode specifier");
  assertEqual(specifiers('import a from "./a";\r\nimport b from "./b";\r\n'), ["./a", "./b"], "CRLF");
  assertEqual(specifiers('﻿import a from "./a";'), ["./a"], "BOM");
});

test("hostile filenames inside specifiers are returned verbatim, never executed", () => {
  const source = 'import x from "./<script>alert(1)</script>";';
  assertEqual(specifiers(source), ["./<script>alert(1)</script>"], "kept as data");
});

// ── size boundaries around the 32 KB binding limit ───────────────────────

test("imports are found on both sides of the 32KB parser boundary", () => {
  // Regression: node-tree-sitter throws above 32 KB when given a plain string,
  // which silently dropped every large file's dependencies.
  for (const target of [32767, 32768, 32769, 65536, 131072, 262144, 524288]) {
    const filler = "const x = 1;\n".repeat(Math.ceil(target / 13));
    const source = `import head from "./head";\n${filler}\nimport tail from "./tail";\n`;
    const result = analyzeSourceFile("big.ts", source);

    assert(!result.failed, `parsed at ~${target} bytes`);
    const found = result.imports.map((i) => i.specifier).sort();
    assertEqual(found, ["./head", "./tail"], `both imports at ~${target} bytes`);
  }
});

test("a one megabyte file still parses without truncating its tail import", () => {
  const filler = "const x = 1;\n".repeat(80000);
  const source = `import head from "./head";\n${filler}\nimport tail from "./tail";\n`;
  assert(source.length > 1_000_000, "fixture is over 1 MB");
  assertEqual(specifiers(source, "big.ts"), ["./head", "./tail"], "tail import survives");
});

// ── malformed source ─────────────────────────────────────────────────────

test("malformed source never throws and never stops analysis", () => {
  const hostile = [
    "function ( { { ###",
    "\u0000\u0001\u0002 ((((( ```",
    "<<<<<<< HEAD\nimport a from './a';\n=======\nimport b from './b';\n>>>>>>> other",
    "'".repeat(5000),
    "(".repeat(2000) + ")".repeat(2000),
    "export ".repeat(1000),
  ];
  for (const source of hostile) {
    const result = analyzeSourceFile("a.ts", source);
    assert(typeof result.failed === "boolean", "returned a result");
    assert(Array.isArray(result.imports), "imports is always an array");
  }
});

test("deeply nested code does not blow the stack", () => {
  const source = "if (a) {".repeat(400) + 'import x from "./x";' + "}".repeat(400);
  const result = analyzeSourceFile("a.ts", source);
  assert(typeof result.failed === "boolean", "no crash");
});

// ── determinism ──────────────────────────────────────────────────────────

test("the graph is identical however the sources are ordered", () => {
  const entries: Array<[string, string]> = [
    ["src/a.ts", 'import "./b";\nimport "./c";'],
    ["src/b.ts", 'import "./c";'],
    ["src/c.ts", 'import "./a";'],
    ["src/d.ts", "export const d = 1;"],
  ];
  const repositoryFiles = new Set(entries.map(([p]) => p));
  const build = (list: Array<[string, string]>) =>
    buildDependencyGraph({
      sources: new Map(list),
      repositoryFiles,
      truncated: false,
      filesSkipped: 0,
    });

  const forward = JSON.stringify(build(entries));
  const reversed = JSON.stringify(build([...entries].reverse()));
  const rotated = JSON.stringify(build([entries[2], entries[0], entries[3], entries[1]]));

  assertEqual(forward, reversed, "reversed order gives the same graph");
  assertEqual(forward, rotated, "rotated order gives the same graph");
});

test("repeated analysis of the same input is byte-identical", () => {
  const sources = new Map([["a.ts", 'import "./b";'], ["b.ts", "export const b = 1;"]]);
  const repositoryFiles = new Set(["a.ts", "b.ts"]);
  const once = JSON.stringify(
    buildDependencyGraph({ sources, repositoryFiles, truncated: false, filesSkipped: 0 })
  );
  const twice = JSON.stringify(
    buildDependencyGraph({ sources, repositoryFiles, truncated: false, filesSkipped: 0 })
  );
  assertEqual(once, twice, "stable");
});

// ── graph shapes ─────────────────────────────────────────────────────────

test("graph shapes from the QA matrix all behave", () => {
  const shapes: Array<[string, Record<string, string>, number, number]> = [
    ["A -> B", { "a.ts": 'import "./b";', "b.ts": "" }, 2, 1],
    ["A -> B -> C", { "a.ts": 'import "./b";', "b.ts": 'import "./c";', "c.ts": "" }, 3, 2],
    ["A -> B, A -> C", { "a.ts": 'import "./b";\nimport "./c";', "b.ts": "", "c.ts": "" }, 3, 2],
    ["A <-> B", { "a.ts": 'import "./b";', "b.ts": 'import "./a";' }, 2, 2],
    ["3-cycle", { "a.ts": 'import "./b";', "b.ts": 'import "./c";', "c.ts": 'import "./a";' }, 3, 3],
    ["self import", { "a.ts": 'import "./a";' }, 1, 0],
    ["duplicate imports", { "a.ts": 'import "./b";\nimport "./b";', "b.ts": "" }, 2, 1],
    ["isolated nodes", { "a.ts": "", "b.ts": "" }, 2, 0],
    ["two components", { "a.ts": 'import "./b";', "b.ts": "", "c.ts": 'import "./d";', "d.ts": "" }, 4, 2],
  ];

  for (const [label, sources, nodes, edges] of shapes) {
    const graph = buildDependencyGraph({
      sources: new Map(Object.entries(sources)),
      repositoryFiles: new Set(Object.keys(sources)),
      truncated: false,
      filesSkipped: 0,
    });
    assertEqual(graph.nodes.length, nodes, `${label}: node count`);
    assertEqual(graph.edges.length, edges, `${label}: edge count`);
    assertEqual(
      new Set(graph.nodes.map((n) => n.id)).size,
      graph.nodes.length,
      `${label}: no duplicate nodes`
    );
    assertEqual(
      new Set(graph.edges.map((e) => e.id)).size,
      graph.edges.length,
      `${label}: no duplicate edges`
    );
  }
});

test("a 1000-node chain builds without recursion problems", () => {
  const sources: Record<string, string> = {};
  for (let i = 0; i < 1000; i++) sources[`f${i}.ts`] = `import "./f${i + 1}";`;
  const graph = buildDependencyGraph({
    sources: new Map(Object.entries(sources)),
    repositoryFiles: new Set(Object.keys(sources)),
    truncated: false,
    filesSkipped: 0,
  });
  assertEqual(graph.nodes.length, 1000, "all nodes");
  assertEqual(graph.edges.length, 999, "chain edges, last target missing");
});

await report("parser and graph hardening tests");
