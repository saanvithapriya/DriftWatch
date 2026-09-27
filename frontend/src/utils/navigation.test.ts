/**
 * Tests for architecture-view navigation: resolving a path to a subtree,
 * walking up, and the breadcrumb segments.
 *
 * Navigation is pure state: a path string plus the immutable tree. These
 * tests walk root -> src -> components -> back -> src -> root and check the
 * node at every step.
 *
 * Run with:  npx tsx src/utils/navigation.test.ts
 */
import type { RepositoryTreeNode } from "../types/github";
import type { TreeNode } from "../types/tree";
import {
  ROOT_PATH,
  buildFileTree,
  createRepositoryRoot,
  findNodeByPath,
  parentPath,
  pathSegments,
} from "./fileTree";
import { assert, assertEqual, report, test } from "./testHarness";

const F = (path: string): RepositoryTreeNode => ({ path, type: "file" });

function repo(...entries: RepositoryTreeNode[]): TreeNode {
  return createRepositoryRoot("octocat/Hello-World", buildFileTree(entries));
}

const TREE = repo(
  F("README.md"),
  F("src/App.tsx"),
  F("src/components/Button.tsx"),
  F("src/components/Navbar.tsx"),
  F("src/pages/Home.tsx"),
  F("backend/services/api.ts")
);

/** Names of the children the diagram would offer at a given path. */
function childNames(path: string): string[] {
  const node = findNodeByPath(TREE, path);
  return node === null ? [] : node.children.map((c) => c.name);
}

test("the repository root resolves to the synthetic root node", () => {
  const node = findNodeByPath(TREE, ROOT_PATH);
  assert(node !== null, "root resolves");
  assertEqual(node?.path, ROOT_PATH, "root path is empty");
  assertEqual(node?.name, "octocat/Hello-World", "root is labelled with the repository");
  assertEqual(childNames(ROOT_PATH), ["backend", "src", "README.md"], "top level");
});

test("walking root -> src -> components -> back -> src -> root", () => {
  // root
  let path = ROOT_PATH;
  assertEqual(childNames(path), ["backend", "src", "README.md"], "at root");

  // -> src
  path = "src";
  assertEqual(findNodeByPath(TREE, path)?.name, "src", "src selected");
  assertEqual(childNames(path), ["components", "pages", "App.tsx"], "src children");

  // -> src/components
  path = "src/components";
  assertEqual(findNodeByPath(TREE, path)?.name, "components", "components selected");
  assertEqual(childNames(path), ["Button.tsx", "Navbar.tsx"], "components children");

  // back up to src
  const up1 = parentPath(path);
  assertEqual(up1, "src", "up from components is src");
  assertEqual(childNames(up1 as string), ["components", "pages", "App.tsx"], "back at src");

  // back up to root
  const up2 = parentPath(up1 as string);
  assertEqual(up2, ROOT_PATH, "up from src is the root");
  assertEqual(childNames(up2 as string), ["backend", "src", "README.md"], "back at root");
});

test("the root has no parent, so Up is disabled there", () => {
  assertEqual(parentPath(ROOT_PATH), null, "no parent at the root");
});

test("breadcrumb segments match the current path", () => {
  assertEqual(pathSegments(ROOT_PATH), [], "root has no crumbs");
  assertEqual(pathSegments("src"), ["src"], "one crumb");
  assertEqual(pathSegments("src/components"), ["src", "components"], "two crumbs");
});

test("a breadcrumb click resolves to that ancestor", () => {
  const segments = pathSegments("src/components");
  const firstCrumb = segments.slice(0, 1).join("/");
  assertEqual(firstCrumb, "src", "first crumb path");
  assertEqual(findNodeByPath(TREE, firstCrumb)?.name, "src", "resolves to src");
});

test("navigating to a path that does not exist returns null", () => {
  assertEqual(findNodeByPath(TREE, "does/not/exist"), null, "missing path");
  assertEqual(findNodeByPath(TREE, "src/nope"), null, "missing child");
});

test("a stale path from another repository does not resolve", () => {
  // Simulates analyzing repository B while the view was deep inside A.
  const other = repo(F("lib/index.ts"));
  assertEqual(findNodeByPath(other, "src/components"), null, "stale path is rejected");
  assert(findNodeByPath(other, ROOT_PATH) !== null, "root always resolves");
});

test("navigation never mutates the tree", () => {
  const before = JSON.stringify(TREE);
  findNodeByPath(TREE, "src/components");
  parentPath("src/components");
  pathSegments("src/components");
  assertEqual(JSON.stringify(TREE), before, "tree unchanged");
});

test("a file path resolves but has no children to drill into", () => {
  const node = findNodeByPath(TREE, "src/App.tsx");
  assertEqual(node?.type, "file", "it is a file");
  assertEqual(node?.children.length, 0, "no children");
});

await report("architecture-view navigation tests");
