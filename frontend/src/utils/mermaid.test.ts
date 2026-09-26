/**
 * Tests for generateMermaidDiagram() and escapeLabel().
 *
 * Run with:  npx tsx src/utils/mermaid.test.ts
 */
import type { TreeNode } from "../types/tree";
import { buildFileTree } from "./fileTree";
import { escapeLabel, generateMermaidDiagram } from "./mermaid";
import { assert, assertEqual, report, test } from "./testHarness";

const REPO = { repositoryLabel: "octocat/Hello-World" };

const f = (name: string, path: string): TreeNode => ({
  name,
  path,
  type: "file",
  children: [],
});

const d = (name: string, path: string, children: TreeNode[]): TreeNode => ({
  name,
  path,
  type: "directory",
  children,
});

/** All node-definition IDs, in order of appearance. */
function nodeIds(diagram: string): string[] {
  const ids: string[] = [];
  for (const line of diagram.split("\n")) {
    const match = /^ {2}([A-Za-z0-9_]+)[[("]/.exec(line);
    if (match !== null) ids.push(match[1]);
  }
  return ids;
}

function edges(diagram: string): string[] {
  return diagram
    .split("\n")
    .filter((line) => line.includes("-->"))
    .map((line) => line.trim());
}

test("diagram starts with a graph TD header", () => {
  assert(
    generateMermaidDiagram([], REPO).startsWith("graph TD"),
    "header present"
  );
});

test("a root node labelled with the repository always exists", () => {
  const out = generateMermaidDiagram([f("README.md", "README.md")], REPO);
  assert(
    out.includes('root(["octocat/Hello-World"])'),
    "root node present, got:\n" + out
  );
});

test("an empty repository still produces a valid diagram with just the root", () => {
  const out = generateMermaidDiagram([], REPO);
  assertEqual(
    out,
    'graph TD\n  root(["octocat/Hello-World"])',
    "root-only diagram"
  );
  assert(!out.includes("-->"), "no edges");
});

test("files and directories both appear, with their names as labels", () => {
  const out = generateMermaidDiagram(
    [d("src", "src", [f("App.tsx", "src/App.tsx")])],
    REPO
  );
  assert(out.includes('"\u{1F4C1} src"'), "directory label present");
  assert(out.includes('"\u{1F4C4} App.tsx"'), "file label present");
});

test("directories and files use distinguishable node shapes", () => {
  const out = generateMermaidDiagram(
    [d("src", "src", [f("App.tsx", "src/App.tsx")])],
    REPO
  );
  assert(/node_\d+\("\u{1F4C1} src"\)/u.test(out), "directory uses rounded shape");
  assert(/node_\d+\["\u{1F4C4} App\.tsx"\]/u.test(out), "file uses rectangle shape");
});

test("every parent-child relationship is represented as an edge", () => {
  const tree = buildFileTree([
    { path: "src/components/Header.tsx", type: "file" },
    { path: "README.md", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, REPO);
  // root + src + components + Header.tsx + README.md
  assertEqual(nodeIds(out).length, 5, "one node per entry");

  const targets = edges(out).map((e) => e.split("-->")[1].trim());
  assertEqual(targets.length, 4, "four edges");
  assertEqual(new Set(targets).size, 4, "each child linked exactly once");
  assert(!targets.includes("root"), "root is never a child");
});

test("every node receives a unique Mermaid ID", () => {
  const tree = buildFileTree([
    { path: "src/a.ts", type: "file" },
    { path: "src/b.ts", type: "file" },
    { path: "lib/a.ts", type: "file" },
  ]);
  const ids = nodeIds(generateMermaidDiagram(tree, REPO));
  assertEqual(new Set(ids).size, ids.length, "IDs unique: " + ids.join(","));
});

test("paths differing only by punctuation get distinct IDs", () => {
  // Regression: IDs derived by substituting unsafe characters mapped
  // a-b.txt, a_b.txt and a.b.txt onto one ID, silently dropping two files.
  const tree = buildFileTree([
    { path: "src/a-b.txt", type: "file" },
    { path: "src/a_b.txt", type: "file" },
    { path: "src/a.b.txt", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, REPO);
  const ids = nodeIds(out);
  assertEqual(new Set(ids).size, ids.length, "no ID collisions");
  for (const name of ["a-b.txt", "a_b.txt", "a.b.txt"]) {
    assert(out.includes('"\u{1F4C4} ' + name + '"'), name + " still present");
  }
  assertEqual(edges(out).length, 4, "src plus three files are all linked");
});

test("identical filenames in different directories remain separate nodes", () => {
  const tree = buildFileTree([
    { path: "src/App.tsx", type: "file" },
    { path: "src/components/App.tsx", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, REPO);
  assertEqual(
    out.split('"\u{1F4C4} App.tsx"').length - 1,
    2,
    "two separate App.tsx nodes"
  );
  const ids = nodeIds(out);
  assertEqual(new Set(ids).size, ids.length, "with distinct IDs");
});

test("special characters are escaped instead of breaking the syntax", () => {
  const tree = buildFileTree([
    { path: 'weird/a"b.ts', type: "file" },
    { path: "weird/a<b>c.ts", type: "file" },
    { path: "weird/a&b#c.ts", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, REPO);

  for (const line of out.split("\n").filter((l) => l.includes("\u{1F4C4}"))) {
    const inner = /"([^"]*)"/.exec(line)?.[1] ?? "";
    assert(!inner.includes('"'), "no raw quote in label: " + line);
    assert(!inner.includes("<"), "no raw angle bracket in label: " + line);
    assert(!inner.includes(">"), "no raw angle bracket in label: " + line);
  }
});

test("bracket-heavy route filenames survive unchanged", () => {
  // Next.js style dynamic routes are common and must not break the diagram.
  const tree = buildFileTree([{ path: "app/[id]/page.tsx", type: "file" }]);
  const out = generateMermaidDiagram(tree, REPO);
  assert(out.includes('"\u{1F4C1} [id]"'), "bracket directory kept, got:\n" + out);
  assert(out.includes('"\u{1F4C4} page.tsx"'), "leaf present");
});

test("escapeLabel escapes # before introducing its own # entities", () => {
  assertEqual(escapeLabel("a#b"), "a#35;b", "hash escaped");
  assertEqual(escapeLabel('a"b'), "a#quot;b", "quote escaped");
  assertEqual(escapeLabel("a&b"), "a#amp;b", "ampersand escaped");
  assertEqual(escapeLabel("<b>"), "#lt;b#gt;", "angle brackets escaped");
  // The '#' of '#amp;' must not be re-escaped into '#35;amp;'.
  assert(!escapeLabel("a&b").includes("#35;"), "no double escaping");
});

test("output is deterministic across repeated calls", () => {
  const tree = buildFileTree([
    { path: "src/components/Header.tsx", type: "file" },
    { path: "src/App.tsx", type: "file" },
    { path: "README.md", type: "file" },
  ]);
  assertEqual(
    generateMermaidDiagram(tree, REPO),
    generateMermaidDiagram(tree, REPO),
    "same input, same output"
  );
});

test("directoriesOnly omits files but keeps the directory skeleton", () => {
  const tree = buildFileTree([
    { path: "src/components/Header.tsx", type: "file" },
    { path: "src/App.tsx", type: "file" },
    { path: "README.md", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, { ...REPO, directoriesOnly: true });
  assert(!out.includes("\u{1F4C4}"), "no file nodes, got:\n" + out);
  assert(out.includes('"\u{1F4C1} src"'), "src kept");
  assert(out.includes('"\u{1F4C1} components"'), "nested directory kept");
});

test("a node appearing twice is defined only once", () => {
  const duplicated: TreeNode[] = [
    d("src", "src", [f("App.tsx", "src/App.tsx")]),
    d("src", "src", [f("App.tsx", "src/App.tsx")]),
  ];
  const out = generateMermaidDiagram(duplicated, REPO);
  assertEqual(out.split('"\u{1F4C1} src"').length - 1, 1, "src defined once");
  assertEqual(
    out.split('"\u{1F4C4} App.tsx"').length - 1,
    1,
    "App.tsx defined once"
  );
});

test("200+ collision-prone paths all receive unique IDs", () => {
  // Every one of these path families collapses onto the same ID under a
  // "replace unsafe characters with _" scheme.
  const flat: Array<{ path: string; type: "file" | "directory" }> = [];
  for (let i = 0; i < 50; i++) {
    flat.push({ path: `src/a-b${i}/file.ts`, type: "file" });
    flat.push({ path: `src/a_b${i}/file.ts`, type: "file" });
    flat.push({ path: `src/a.b${i}/file.ts`, type: "file" });
    flat.push({ path: `src/a b${i}/file.ts`, type: "file" });
  }
  const tree = buildFileTree(flat);
  const out = generateMermaidDiagram(tree, REPO);
  const ids = nodeIds(out);

  assert(ids.length > 200, `more than 200 nodes, got ${ids.length}`);
  assertEqual(new Set(ids).size, ids.length, "every ID is unique");

  // Each edge target must be a node that was actually defined.
  const defined = new Set(ids);
  for (const edge of edges(out)) {
    const [from, to] = edge.split("-->").map((p) => p.trim());
    assert(from === "root" || defined.has(from), `edge source defined: ${from}`);
    assert(defined.has(to), `edge target defined: ${to}`);
  }
});

test("node IDs are always valid Mermaid identifiers", () => {
  const flat: Array<{ path: string; type: "file" | "directory" }> = [
    { path: '1-starts-with-digit/a"b.ts', type: "file" },
    { path: "graph/end/subgraph.ts", type: "file" },
    { path: "éüñ/中文.ts", type: "file" },
    { path: "sp ace/tab	char.ts", type: "file" },
  ];
  const ids = nodeIds(generateMermaidDiagram(buildFileTree(flat), REPO));
  for (const id of ids) {
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(id), `valid identifier: ${id}`);
  }
});

test("parent-child edges mirror the real hierarchy, not just string presence", () => {
  const tree = buildFileTree([
    { path: "src/components/Header.tsx", type: "file" },
  ]);
  const out = generateMermaidDiagram(tree, REPO);

  // Resolve each ID back to its label so the edges can be checked by name.
  const labelById = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^ {2}([A-Za-z0-9_]+)[[("]+"([^"]*)"/.exec(line);
    if (m !== null) labelById.set(m[1], m[2].replace(/^[^ ]+ /, ""));
  }
  labelById.set("root", "octocat/Hello-World");

  const named = edges(out).map((e) => {
    const [from, to] = e.split("-->").map((p) => p.trim());
    return `${labelById.get(from)} -> ${labelById.get(to)}`;
  });

  assertEqual(
    named,
    [
      "octocat/Hello-World -> src",
      "src -> components",
      "components -> Header.tsx",
    ],
    "the chain repository -> src -> components -> Header.tsx"
  );
});

report("generateMermaidDiagram() tests");
