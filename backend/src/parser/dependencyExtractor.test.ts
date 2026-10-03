/**
 * Tests for Tree-sitter import extraction across JavaScript, JSX, TypeScript
 * and TSX.
 *
 * Run with:  npx tsx src/parser/dependencyExtractor.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { analyzeSourceFile } from "./dependencyExtractor.js";
import type { ImportKind } from "./parserTypes.js";

/** Specifiers extracted from a file, sorted so assertions are order-free. */
function specifiers(path: string, source: string): string[] {
  const result = analyzeSourceFile(path, source);
  assert(!result.failed, `parsed ${path}`);
  return result.imports.map((i) => i.specifier).sort();
}

function kinds(path: string, source: string): ImportKind[] {
  return analyzeSourceFile(path, source).imports.map((i) => i.kind);
}

// ── languages ────────────────────────────────────────────────────────────

test("JavaScript: default import", () => {
  assertEqual(specifiers("a.js", 'import x from "./x";'), ["./x"], "extracted");
});

test("JSX: component import alongside JSX syntax", () => {
  const source = 'import Header from "./Header";\nexport default () => <Header />;';
  assertEqual(specifiers("a.jsx", source), ["./Header"], "extracted");
});

test("TypeScript: named and type imports", () => {
  const source = 'import { User } from "./types";\nimport type { Id } from "./ids";';
  assertEqual(specifiers("a.ts", source), ["./ids", "./types"], "both extracted");
});

test("TSX: import plus JSX and generics", () => {
  const source =
    'import Component from "./Component";\nconst f = <T,>(x: T) => <Component v={x} />;';
  assertEqual(specifiers("a.tsx", source), ["./Component"], "extracted");
});

// ── import syntax ────────────────────────────────────────────────────────

test("named, aliased and namespace imports", () => {
  const source = [
    'import { foo } from "./foo";',
    'import { bar as baz } from "./bar";',
    'import * as utils from "./utils";',
  ].join("\n");
  assertEqual(specifiers("a.ts", source), ["./bar", "./foo", "./utils"], "all three");
});

test("side-effect import with no bindings", () => {
  assertEqual(specifiers("a.ts", 'import "./styles.css";'), ["./styles.css"], "extracted");
});

test("dynamic import", () => {
  const source = 'const load = () => import("./lazy");';
  assertEqual(specifiers("a.ts", source), ["./lazy"], "extracted");
  assertEqual(kinds("a.ts", source), ["dynamic"], "classified as dynamic");
});

test("CommonJS require", () => {
  const source = 'const foo = require("./foo");';
  assertEqual(specifiers("a.js", source), ["./foo"], "extracted");
  assertEqual(kinds("a.js", source), ["require"], "classified as require");
});

test("export-from re-exports", () => {
  const source = [
    'export { foo } from "./foo";',
    'export { bar as baz } from "./bar";',
    'export * from "./star";',
    'export * as ns from "./ns";',
  ].join("\n");
  assertEqual(
    specifiers("a.ts", source),
    ["./bar", "./foo", "./ns", "./star"],
    "all re-exports"
  );
  assert(
    kinds("a.ts", source).every((k) => k === "export-from"),
    "classified as export-from"
  );
});

test("a plain export is not a dependency", () => {
  const source = "export const x = 1;\nexport default function f() {}";
  assertEqual(specifiers("a.ts", source), [], "no specifiers");
});

test("multiple imports in one file are all extracted", () => {
  const source = [
    'import a from "./a";',
    'import { b } from "./b";',
    'import * as c from "./c";',
    'import "./d";',
    'const e = require("./e");',
    'export * from "./f";',
    'const g = import("./g");',
    'import React from "react";',
  ].join("\n");
  assertEqual(
    specifiers("a.tsx", source),
    ["./a", "./b", "./c", "./d", "./e", "./f", "./g", "react"],
    "eight specifiers"
  );
});

test("duplicate imports are both reported (deduplication happens in the graph)", () => {
  const source = 'import "./foo";\nimport "./foo";';
  assertEqual(specifiers("a.ts", source), ["./foo", "./foo"], "both seen");
});

test("external packages are extracted as written", () => {
  const source = [
    'import React from "react";',
    'import { debounce } from "lodash/debounce";',
    'import axios from "axios";',
  ].join("\n");
  assertEqual(
    specifiers("a.ts", source),
    ["axios", "lodash/debounce", "react"],
    "scoped and plain packages"
  );
});

test("a non-literal specifier is not guessed at", () => {
  // `require(name)` has no static target; inventing one would be wrong.
  const source = "const name = './x';\nconst m = require(name);";
  assertEqual(specifiers("a.js", source), [], "nothing extracted");
});

test("imports inside nested scopes are still found", () => {
  const source = [
    "async function load() {",
    "  if (true) {",
    '    const m = await import("./deep");',
    "  }",
    "}",
  ].join("\n");
  assertEqual(specifiers("a.ts", source), ["./deep"], "found in nested block");
});

// ── robustness ───────────────────────────────────────────────────────────

test("malformed source still yields the imports it understood", () => {
  // Tree-sitter is error-tolerant: the broken function must not hide the import.
  const source = 'import a from "./a";\nfunction ( { { broken syntax ###';
  const result = analyzeSourceFile("a.ts", source);
  assert(!result.failed, "not treated as a hard failure");
  assertEqual(
    result.imports.map((i) => i.specifier),
    ["./a"],
    "import still extracted"
  );
});

test("completely unparseable junk does not throw", () => {
  const result = analyzeSourceFile("a.ts", "\u0000\u0001\u0002 ((((( ```");
  assert(typeof result.failed === "boolean", "returned a result rather than throwing");
});

test("an empty file yields no imports", () => {
  assertEqual(specifiers("a.ts", ""), [], "empty");
});

test("an unsupported extension is reported as failed rather than parsed as JS", () => {
  const result = analyzeSourceFile("a.py", 'import os');
  assertEqual(result.failed, true, "skipped");
  assertEqual(result.imports, [], "no imports");
});

test("files larger than the 32KB binding limit are parsed correctly", () => {
  // Regression: node-tree-sitter throws on strings above 32 KB, which silently
  // dropped every large file's dependencies until a chunked reader was used.
  const big =
    'import a from "./a";\nimport b from "./b";\n' + "const x = 1;\n".repeat(6000);
  assert(big.length > 32768, "fixture is above the limit");
  const result = analyzeSourceFile("big.ts", big);
  assert(!result.failed, "parsed");
  assertEqual(
    result.imports.map((i) => i.specifier).sort(),
    ["./a", "./b"],
    "imports extracted from a large file"
  );
});

test("extraction is deterministic", () => {
  const source = 'import a from "./a";\nimport b from "./b";\nexport * from "./c";';
  assertEqual(
    analyzeSourceFile("a.ts", source).imports,
    analyzeSourceFile("a.ts", source).imports,
    "same input, same output"
  );
});

await report("Tree-sitter dependency extraction tests");
