/**
 * Tests for treeToMermaid()
 *
 * Plain TypeScript — no test-framework dependency.
 * Each test throws on failure so the exit code is non-zero if any test fails.
 *
 * Run with:  npx tsx src/utils/mermaid.test.ts
 */
import { treeToMermaid, type TreeNode } from "./mermaid";

// ── helpers ──────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

interface TestResult {
  label: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(label: string, fn: () => void): void {
  try {
    fn();
    results.push({ label, passed: true });
  } catch (err) {
    results.push({
      label,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── test cases ────────────────────────────────────────────────────────────────

// 1. Empty tree
test("empty tree returns valid header only", () => {
  const result = treeToMermaid([]);
  assert(result === "graph TD", `Expected "graph TD", got: ${result}`);
});

// 2. Single file
test("single file produces a rectangle node definition", () => {
  const tree: TreeNode[] = [
    { name: "README.md", path: "README.md", type: "file" },
  ];
  const result = treeToMermaid(tree);
  assert(result.startsWith("graph TD"), "must start with graph TD");
  assert(result.includes("n_README_md"), "must contain node ID for README.md");
  // File nodes use square-bracket syntax: id["label"]
  assert(result.includes("n_README_md["), "file node must use rect [ syntax");
});

// 3. Directory with one child file → parent → child edge
test("directory with one file produces a parent → child edge", () => {
  const tree: TreeNode[] = [
    {
      name: "src",
      path: "src",
      type: "directory",
      children: [{ name: "index.ts", path: "src/index.ts", type: "file" }],
    },
  ];
  const result = treeToMermaid(tree);
  assert(result.includes("n_src"), "must contain src node ID");
  assert(result.includes("n_src_index_ts"), "must contain child node ID");
  assert(result.includes("n_src --> n_src_index_ts"), "must contain edge");
  // Directory uses rounded-bracket shape: id("label")
  assert(result.includes('n_src("'), "directory must use rounded ( shape");
});

// 4. Nested directories — all intermediate edges present
test("deeply nested directories produce all edges", () => {
  const tree: TreeNode[] = [
    {
      name: "a",
      path: "a",
      type: "directory",
      children: [
        {
          name: "b",
          path: "a/b",
          type: "directory",
          children: [{ name: "c.ts", path: "a/b/c.ts", type: "file" }],
        },
      ],
    },
  ];
  const result = treeToMermaid(tree);
  assert(result.includes("n_a --> n_a_b"), "must have edge a → b");
  assert(result.includes("n_a_b --> n_a_b_c_ts"), "must have edge b → c");
});

// 5. Multiple sibling files — all unique node IDs
test("multiple sibling files all get unique, distinct node IDs", () => {
  const tree: TreeNode[] = [
    {
      name: "src",
      path: "src",
      type: "directory",
      children: [
        { name: "alpha.ts", path: "src/alpha.ts", type: "file" },
        { name: "beta.ts", path: "src/beta.ts", type: "file" },
        { name: "gamma.ts", path: "src/gamma.ts", type: "file" },
      ],
    },
  ];
  const result = treeToMermaid(tree);
  const ids = ["n_src_alpha_ts", "n_src_beta_ts", "n_src_gamma_ts"];
  for (const id of ids) {
    assert(result.includes(id), `must contain node ID: ${id}`);
  }
  // Each definition line must appear exactly once
  const definitionLines = result
    .split("\n")
    .filter((l) => !l.includes("-->"))
    .join("\n");
  for (const id of ids) {
    const matches = definitionLines.match(new RegExp(id, "g")) ?? [];
    assert(matches.length === 1, `${id} defined ${matches.length}×, expected 1`);
  }
});

// 6. Special characters in filenames — must not break Mermaid label syntax
test("special characters in filenames are escaped in labels", () => {
  const tree: TreeNode[] = [
    {
      name: 'say "hello" & more',
      path: 'say "hello" & more',
      type: "file",
    },
  ];
  const result = treeToMermaid(tree);
  // Raw unescaped double-quote inside the label would break Mermaid rendering
  // The label is wrapped in double-quotes, so inner " must be escaped as \"
  assert(
    !result.match(/\["say "hello"/),
    "raw double-quote inside label must be escaped"
  );
  // The path-derived node ID must sanitise special chars to underscores
  assert(result.includes("n_say__hello__"), "path-based ID must be sanitised");
});

// 7. Deterministic — same input always produces identical output
test("same input produces identical output across multiple calls (deterministic)", () => {
  const tree: TreeNode[] = [
    {
      name: "lib",
      path: "lib",
      type: "directory",
      children: [
        { name: "util.ts", path: "lib/util.ts", type: "file" },
        { name: "core.ts", path: "lib/core.ts", type: "file" },
      ],
    },
    { name: "index.ts", path: "index.ts", type: "file" },
  ];

  const first = treeToMermaid(tree);
  const second = treeToMermaid(tree);
  const third = treeToMermaid(tree);

  assert(first === second, "first and second runs produced different output");
  assert(second === third, "second and third runs produced different output");
});

// 8. Duplicate paths — node defined only once (de-dup guard)
test("nodes with duplicate paths are defined exactly once", () => {
  // Same object reference inserted twice — synthetic edge case to exercise the
  // seen-set guard in treeToMermaid.
  const shared: TreeNode = {
    name: "shared.ts",
    path: "shared.ts",
    type: "file",
  };
  const tree: TreeNode[] = [shared, shared];
  const result = treeToMermaid(tree);

  // Count definition occurrences (lines that contain the id + "[")
  const definitionLines = result
    .split("\n")
    .filter((l) => l.includes("n_shared_ts["));
  assert(
    definitionLines.length === 1,
    `node defined ${definitionLines.length}×, expected 1`
  );
});

// ── report ────────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log("\ntreeToMermaid() tests\n");
for (const r of results) {
  if (r.passed) {
    console.log(`  ✓ ${r.label}`);
  } else {
    console.error(`  ✗ ${r.label}`);
    console.error(`    ${r.error ?? "(no message)"}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed.\n`);

if (failed > 0) {
  throw new Error(`${failed} test(s) failed.`);
}
