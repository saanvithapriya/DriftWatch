/**
 * Tests for buildFileTree() and countTreeNodes().
 *
 * Run with:  npx tsx src/utils/fileTree.test.ts
 */
import type { RepositoryTreeNode } from "../types/github";
import type { TreeNode } from "../types/tree";
import { buildFileTree, countTreeNodes } from "./fileTree";
import { assert, assertEqual, report, test } from "./testHarness";

const file = (path: string): RepositoryTreeNode => ({ path, type: "file" });
const dir = (path: string): RepositoryTreeNode => ({ path, type: "directory" });

/** Renders a tree as indented text so hierarchy assertions read clearly. */
function outline(nodes: readonly TreeNode[], depth = 0): string {
  return nodes
    .map((n) => {
      const line = `${"  ".repeat(depth)}${n.name}${n.type === "directory" ? "/" : ""}`;
      return n.children.length > 0
        ? `${line}\n${outline(n.children, depth + 1)}`
        : line;
    })
    .join("\n");
}

function find(nodes: readonly TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const hit = find(node.children, path);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

test("empty input produces an empty tree", () => {
  assertEqual(buildFileTree([]), [], "empty input");
});

test("root-level files become root nodes, alphabetically ordered", () => {
  const tree = buildFileTree([file("README.md"), file("package.json")]);
  assertEqual(
    tree.map((n) => n.name),
    ["package.json", "README.md"],
    "root files sorted alphabetically"
  );
  assert(tree.every((n) => n.type === "file"), "both are files");
});

test("nested files are nested under their directory", () => {
  const tree = buildFileTree([
    file("src/App.tsx"),
    file("src/components/Header.tsx"),
  ]);
  assertEqual(
    outline(tree),
    ["src/", "  components/", "    Header.tsx", "  App.tsx"].join("\n"),
    "nested hierarchy"
  );
});

test("deep nesting creates every intermediate directory", () => {
  const tree = buildFileTree([
    file("src/features/auth/components/Login/Button.tsx"),
  ]);
  for (const path of [
    "src",
    "src/features",
    "src/features/auth",
    "src/features/auth/components",
    "src/features/auth/components/Login",
  ]) {
    const node = find(tree, path);
    assert(node !== undefined, `${path} exists`);
    assert(node?.type === "directory", `${path} is a directory`);
  }
  const leaf = find(tree, "src/features/auth/components/Login/Button.tsx");
  assert(leaf?.type === "file", "leaf is a file");
});

test("duplicate names in different directories stay distinct", () => {
  const tree = buildFileTree([
    file("src/pages/Home.tsx"),
    file("src/components/Home.tsx"),
  ]);
  const a = find(tree, "src/pages/Home.tsx");
  const b = find(tree, "src/components/Home.tsx");
  assert(a !== undefined && b !== undefined, "both nodes exist");
  assert(a !== b, "they are separate nodes");
  assert(a?.name === b?.name, "they share a display name");
});

test("directories are ordered before files at every level", () => {
  const tree = buildFileTree([
    file("src/main.tsx"),
    file("src/App.tsx"),
    dir("src/pages"),
    dir("src/components"),
    file("README.md"),
  ]);
  assertEqual(
    outline(tree),
    ["src/", "  components/", "  pages/", "  App.tsx", "  main.tsx", "README.md"].join("\n"),
    "directories before files, alphabetical within each group"
  );
});

test("a directory listed explicitly is not duplicated by its children", () => {
  const tree = buildFileTree([
    dir("src"),
    file("src/App.tsx"),
    dir("src"),
  ]);
  assertEqual(tree.length, 1, "one root node");
  assertEqual(tree[0].children.length, 1, "one child");
  assertEqual(tree[0].type, "directory", "still a directory");
});

test("full paths and types are preserved", () => {
  const tree = buildFileTree([file("a/b/c.txt"), dir("a/d")]);
  assertEqual(find(tree, "a/b/c.txt")?.path, "a/b/c.txt", "leaf path preserved");
  assertEqual(find(tree, "a/d")?.type, "directory", "directory type preserved");
  assertEqual(find(tree, "a/b")?.type, "directory", "implied parent is a directory");
});

test("ordering is deterministic across repeated runs", () => {
  const input = [
    file("src/components/Header.tsx"),
    file("README.md"),
    file("src/App.tsx"),
    dir("src/pages"),
  ];
  assertEqual(buildFileTree(input), buildFileTree(input), "identical output");
});

test("input order does not change the output", () => {
  const a = buildFileTree([
    file("src/App.tsx"),
    file("src/components/Header.tsx"),
    file("README.md"),
  ]);
  const b = buildFileTree([
    file("README.md"),
    file("src/components/Header.tsx"),
    file("src/App.tsx"),
  ]);
  assertEqual(a, b, "shuffled input produces the same tree");
});

test("a truncated response with missing parents still nests correctly", () => {
  // GitHub cut off the `deep` and `deep/nested` directory entries.
  const tree = buildFileTree([file("deep/nested/orphan.ts")]);
  assertEqual(
    outline(tree),
    ["deep/", "  nested/", "    orphan.ts"].join("\n"),
    "intermediate directories synthesized"
  );
});

test("countTreeNodes counts files and directories at every depth", () => {
  const tree = buildFileTree([
    file("src/App.tsx"),
    file("src/components/Header.tsx"),
    file("README.md"),
  ]);
  assertEqual(
    countTreeNodes(tree),
    { files: 3, directories: 2, total: 5 },
    "counts across the whole tree"
  );
});

test("countTreeNodes on an empty tree is all zeroes", () => {
  assertEqual(countTreeNodes([]), { files: 0, directories: 0, total: 0 }, "zeroes");
});

report("buildFileTree() / countTreeNodes() tests");
