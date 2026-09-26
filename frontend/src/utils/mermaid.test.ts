/**
 * Tests for the architecture-explorer Mermaid generator.
 *
 * Run with:  npx tsx src/utils/mermaid.test.ts
 */
import type { RepositoryTreeNode } from "../types/github";
import type { TreeNode } from "../types/tree";
import { buildFileTree, createRepositoryRoot, findNodeByPath } from "./fileTree";
import {
  MAX_DIAGRAM_NODES,
  countDiagramNodes,
  describeDirectory,
  escapeLabel,
  generateMermaidDiagram,
} from "./mermaid";
import { assert, assertEqual, report, test } from "./testHarness";

const F = (path: string): RepositoryTreeNode => ({ path, type: "file" });
const D = (path: string): RepositoryTreeNode => ({ path, type: "directory" });

function repo(...entries: RepositoryTreeNode[]): TreeNode {
  return createRepositoryRoot("octocat/Hello-World", buildFileTree(entries));
}

function at(root: TreeNode, path: string): TreeNode {
  const node = findNodeByPath(root, path);
  if (node === null) throw new Error(`missing node: ${path}`);
  return node;
}

/** All node-definition IDs, in order of appearance. */
function nodeIds(definition: string): string[] {
  const ids: string[] = [];
  for (const line of definition.split("\n")) {
    const match = /^ {2}([A-Za-z0-9_]+)[[("]/.exec(line);
    if (match !== null) ids.push(match[1]);
  }
  return ids;
}

function edges(definition: string): string[] {
  return definition.split("\n").filter((l) => l.includes("-->")).map((l) => l.trim());
}

const SAMPLE = repo(
  F("README.md"),
  F("package.json"),
  F("src/App.tsx"),
  F("src/main.tsx"),
  F("src/components/Header.tsx"),
  F("src/components/Footer.tsx"),
  F("src/pages/Home.tsx"),
  F("backend/controllers/a.ts"),
  F("backend/services/b.ts")
);

const DIRS_ONLY = { showFiles: false };
const WITH_FILES = { showFiles: true };

test("the root diagram shows only top-level entries, never the whole tree", () => {
  const out = generateMermaidDiagram(SAMPLE, WITH_FILES);
  assert(out.definition !== null, "a diagram was produced");
  const def = out.definition as string;

  // Top level is: backend/, src/, package.json, README.md
  assertEqual(out.nodeCount, 4, "four top-level entries");
  assert(def.includes('"📁 src'), "src present");
  assert(def.includes('"📁 backend'), "backend present");
  assert(def.includes('"📄 README.md"'), "root file present");
  // Nothing from deeper levels may leak in.
  assert(!def.includes("Header.tsx"), "no grandchildren");
  assert(!def.includes("components"), "no grandchild directories");
});

test("root-level files stay visible alongside directories", () => {
  const def = generateMermaidDiagram(SAMPLE, WITH_FILES).definition as string;
  assert(def.includes('"📄 package.json"'), "package.json shown");
  assert(def.includes('"📄 README.md"'), "README.md shown");
});

test("files are hidden by default and shown on request", () => {
  const hidden = generateMermaidDiagram(SAMPLE, DIRS_ONLY);
  assertEqual(hidden.nodeCount, 2, "only the two directories");
  assert(!(hidden.definition as string).includes("📄"), "no file nodes");

  const shown = generateMermaidDiagram(SAMPLE, WITH_FILES);
  assertEqual(shown.nodeCount, 4, "directories plus root files");
  assert((shown.definition as string).includes("📄"), "file nodes present");
});

test("drilling into a directory shows only that directory's children", () => {
  const out = generateMermaidDiagram(at(SAMPLE, "src"), WITH_FILES);
  const def = out.definition as string;
  assertEqual(out.nodeCount, 4, "components, pages, App.tsx, main.tsx");
  assert(def.includes('"📁 components'), "components present");
  assert(def.includes('"📁 pages'), "pages present");
  assert(def.includes('"📄 App.tsx"'), "App.tsx present");
  assert(!def.includes("Header.tsx"), "grandchildren excluded");
});

test("the selected directory becomes the diagram root", () => {
  const def = generateMermaidDiagram(at(SAMPLE, "src/components"), WITH_FILES)
    .definition as string;
  assert(/root\(\["components/.test(def), "components is the root node");
  const targets = edges(def).map((e) => e.split("-->")[1].trim());
  assertEqual(targets.length, 2, "two children linked");
  assert(!targets.includes("root"), "root is never a child");
});

test("depth 2 adds one more level and nothing beyond it", () => {
  const out = generateMermaidDiagram(SAMPLE, { showFiles: false, depth: 2 });
  const def = out.definition as string;
  // backend + src, plus their subdirectories (controllers, services, components, pages)
  assertEqual(out.nodeCount, 6, "two directories plus four subdirectories");
  assert(def.includes('"📁 components'), "grandchild directory present");
  assert(!def.includes("Header.tsx"), "great-grandchildren excluded");
});

test("every node receives a unique, valid Mermaid identifier", () => {
  const tree = repo(
    F("src/a-b.txt"), F("src/a_b.txt"), F("src/a.b.txt"),
    F("src/a b.txt"), F("src/A-B.txt")
  );
  const ids = nodeIds(generateMermaidDiagram(at(tree, "src"), WITH_FILES).definition as string);
  assertEqual(new Set(ids).size, ids.length, "no collisions: " + ids.join(","));
  for (const id of ids) {
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(id), "valid identifier: " + id);
  }
});

test("200+ collision-prone children still get unique IDs", () => {
  const entries: RepositoryTreeNode[] = [];
  for (let i = 0; i < 60; i++) {
    entries.push(F(`src/a-b${i}.ts`), F(`src/a_b${i}.ts`), F(`src/a.b${i}.ts`), F(`src/a b${i}.ts`));
  }
  const tree = repo(...entries);
  const out = generateMermaidDiagram(at(tree, "src"), { showFiles: true, maxNodes: 1000 });
  const ids = nodeIds(out.definition as string);
  assert(ids.length > 200, "more than 200 nodes, got " + ids.length);
  assertEqual(new Set(ids).size, ids.length, "all unique");
});

test("special characters are escaped instead of breaking the syntax", () => {
  const tree = repo(
    F('w/a"q.ts'), F("w/a<b>c.ts"), F("w/a&b.ts"), F("w/a#b.ts"),
    F("w/[id].tsx"), F("w/(g).ts"), F("w/{b}.ts"), F("w/it's.ts"),
    F("w/a+b.ts"), F("w/a@b.ts"), F("w/a$b.ts"), F("w/a%b.ts")
  );
  const def = generateMermaidDiagram(at(tree, "w"), WITH_FILES).definition as string;
  for (const line of def.split("\n").filter((l) => l.includes("📄"))) {
    const inner = /"([^"]*)"/.exec(line)?.[1] ?? "";
    assert(!inner.includes('"'), "no raw quote: " + line);
    assert(!inner.includes("<"), "no raw angle bracket: " + line);
    assert(!inner.includes(">"), "no raw angle bracket: " + line);
  }
  assert(def.includes("[id].tsx"), "bracket filename preserved");
});

test("escapeLabel escapes # before introducing its own # entities", () => {
  assertEqual(escapeLabel("a#b"), "a#35;b", "hash escaped");
  assertEqual(escapeLabel('a"b'), "a#quot;b", "quote escaped");
  assertEqual(escapeLabel("a&b"), "a#amp;b", "ampersand escaped");
  assertEqual(escapeLabel("<b>"), "#lt;b#gt;", "angle brackets escaped");
  assert(!escapeLabel("a&b").includes("#35;"), "no double escaping");
});

test("directory nodes carry their descendant counts", () => {
  const def = generateMermaidDiagram(SAMPLE, DIRS_ONLY).definition as string;
  // src holds 2 subdirectories and 5 files in total.
  assertEqual(describeDirectory(at(SAMPLE, "src")), "2 dirs · 5 files", "src summary");
  assert(def.includes("2 dirs · 5 files"), "counts rendered in the label, got:\n" + def);
});

test("counts are pluralized correctly", () => {
  const tree = repo(F("one/a.ts"), F("many/a.ts"), F("many/b.ts"), F("many/sub/c.ts"));
  assertEqual(describeDirectory(at(tree, "one")), "1 file", "singular file");
  assertEqual(describeDirectory(at(tree, "many")), "1 dir · 3 files", "singular dir, plural files");
});

test("a directory with no files reports only its file count", () => {
  const tree = repo(F("empty-ish/a.ts"));
  assertEqual(describeDirectory(at(tree, "empty-ish")), "1 file", "no dirs segment, singular file");
});

test("the max-node guard refuses to build an oversized diagram", () => {
  const entries: RepositoryTreeNode[] = [];
  for (let i = 0; i < MAX_DIAGRAM_NODES + 10; i++) entries.push(F(`wide/f${i}.ts`));
  const tree = repo(...entries);

  const out = generateMermaidDiagram(at(tree, "wide"), WITH_FILES);
  assertEqual(out.exceededMaxNodes, true, "guard tripped");
  assertEqual(out.definition, null, "nothing generated");
  assertEqual(out.nodeCount, MAX_DIAGRAM_NODES + 10, "count still reported");

  // Hiding files brings the same directory back under the limit.
  const dirsOnly = generateMermaidDiagram(at(tree, "wide"), DIRS_ONLY);
  assertEqual(dirsOnly.exceededMaxNodes, false, "directories-only fits");
});

test("the guard honours an explicit maxNodes", () => {
  const out = generateMermaidDiagram(SAMPLE, { showFiles: true, maxNodes: 2 });
  assertEqual(out.exceededMaxNodes, true, "tripped at 2");
  assertEqual(generateMermaidDiagram(SAMPLE, { showFiles: true, maxNodes: 4 }).exceededMaxNodes, false, "fits at 4");
});

test("countDiagramNodes matches what the generator draws", () => {
  for (const options of [DIRS_ONLY, WITH_FILES, { showFiles: true, depth: 2 as const }]) {
    const expected = countDiagramNodes(SAMPLE, { ...options, maxNodes: 10000 });
    const actual = generateMermaidDiagram(SAMPLE, { ...options, maxNodes: 10000 }).nodeCount;
    assertEqual(actual, expected, "counts agree for " + JSON.stringify(options));
  }
});

test("an empty directory produces a valid root-only diagram", () => {
  const tree = repo(D("hollow"));
  const out = generateMermaidDiagram(at(tree, "hollow"), WITH_FILES);
  assertEqual(out.nodeCount, 0, "no children");
  assert((out.definition as string).startsWith("graph TD"), "valid header");
  assert(!(out.definition as string).includes("-->"), "no edges");
});

test("an empty repository produces a valid root-only diagram", () => {
  const out = generateMermaidDiagram(repo(), WITH_FILES);
  assertEqual(out.nodeCount, 0, "no children");
  assertEqual(
    out.definition,
    'graph TD\n  root(["octocat/Hello-World<br/>0 files"])',
    "root-only diagram"
  );
});

test("pathsById maps every drawn node back to its repository path", () => {
  const out = generateMermaidDiagram(SAMPLE, WITH_FILES);
  assertEqual(out.pathsById.get("root"), "", "root maps to the repository root");
  const paths = [...out.pathsById.values()].sort();
  assertEqual(paths, ["", "README.md", "backend", "package.json", "src"], "all paths mapped");
});

test("pathsById after drilling in maps to full paths, not names", () => {
  const out = generateMermaidDiagram(at(SAMPLE, "src"), WITH_FILES);
  const paths = [...out.pathsById.values()].sort();
  assertEqual(
    paths,
    ["src", "src/App.tsx", "src/components", "src/main.tsx", "src/pages"],
    "fully qualified paths"
  );
});

test("output is deterministic across repeated calls", () => {
  assertEqual(
    generateMermaidDiagram(SAMPLE, WITH_FILES).definition,
    generateMermaidDiagram(SAMPLE, WITH_FILES).definition,
    "same input, same output"
  );
});

report("architecture-explorer Mermaid generator tests");
