/**
 * Tests for planDiagram() and countVisibleNodes().
 *
 * Run with:  npx tsx src/utils/diagramPlan.test.ts
 */
import type { RepositoryTreeNode } from "../types/github";
import {
  AUTO_RENDER_LIMIT,
  OPT_IN_LIMIT,
  countVisibleNodes,
  planDiagram,
} from "./diagramPlan";
import { buildFileTree } from "./fileTree";
import { assert, assertEqual, report, test } from "./testHarness";

/** A tree of `dirs` directories each holding `filesPerDir` files. */
function wideRepo(dirs: number, filesPerDir: number): RepositoryTreeNode[] {
  const nodes: RepositoryTreeNode[] = [];
  for (let d = 0; d < dirs; d++) {
    nodes.push({ path: `d${d}`, type: "directory" });
    for (let i = 0; i < filesPerDir; i++) {
      nodes.push({ path: `d${d}/f${i}.ts`, type: "file" });
    }
  }
  return nodes;
}

/** A single chain `l1/l2/.../lN/leaf.ts`. */
function deepRepo(depth: number): RepositoryTreeNode[] {
  const segments: string[] = [];
  for (let i = 1; i <= depth; i++) segments.push(`l${i}`);
  return [{ path: `${segments.join("/")}/leaf.ts`, type: "file" }];
}

test("countVisibleNodes counts the whole tree by default", () => {
  const tree = buildFileTree(wideRepo(2, 3));
  assertEqual(countVisibleNodes(tree), 8, "2 dirs + 6 files");
});

test("countVisibleNodes honours directoriesOnly", () => {
  const tree = buildFileTree(wideRepo(2, 3));
  assertEqual(countVisibleNodes(tree, { directoriesOnly: true }), 2, "dirs only");
});

test("countVisibleNodes honours maxDepth", () => {
  const tree = buildFileTree(deepRepo(5));
  assertEqual(countVisibleNodes(tree, { maxDepth: 1 }), 1, "top level only");
  assertEqual(countVisibleNodes(tree, { maxDepth: 3 }), 3, "three levels");
  assertEqual(countVisibleNodes(tree), 6, "five dirs plus the leaf");
});

test("a small repository renders in full without confirmation", () => {
  const tree = buildFileTree(wideRepo(2, 3));
  const plan = planDiagram(tree, "all");
  assertEqual(plan.nodeCount, 8, "all nodes");
  assertEqual(plan.needsConfirmation, false, "no confirmation needed");
  assertEqual(plan.depthLimited, false, "no depth cap");
  assertEqual(plan.tooLarge, false, "not too large");
  assertEqual(plan.maxDepth, undefined, "unlimited depth");
});

test("a medium repository renders in full but asks first", () => {
  // Above the auto limit, still within the opt-in limit.
  const tree = buildFileTree(wideRepo(10, 29)); // 10 + 290 = 300 nodes
  const plan = planDiagram(tree, "all");
  assertEqual(plan.nodeCount, 300, "all nodes still drawn");
  assert(plan.nodeCount > AUTO_RENDER_LIMIT, "above the auto limit");
  assert(plan.nodeCount <= OPT_IN_LIMIT, "within the opt-in limit");
  assertEqual(plan.needsConfirmation, true, "confirmation required");
  assertEqual(plan.tooLarge, false, "still drawable");
});

test("a large repository is reduced by depth until it fits", () => {
  // 100 dirs x 20 files = 2100 nodes, far past the opt-in limit.
  const tree = buildFileTree(wideRepo(100, 20));
  const plan = planDiagram(tree, "all");
  assertEqual(plan.tooLarge, false, "a reduced view fits");
  assertEqual(plan.depthLimited, true, "depth was capped");
  assertEqual(plan.maxDepth, 1, "only the top level fits");
  assertEqual(plan.nodeCount, 100, "the 100 top-level directories");
  assert(plan.nodeCount <= OPT_IN_LIMIT, "within the opt-in limit");
});

test("directories-only mode drops the files from the count", () => {
  const tree = buildFileTree(wideRepo(100, 20));
  const plan = planDiagram(tree, "directories");
  assertEqual(plan.directoriesOnly, true, "directories only");
  assertEqual(plan.nodeCount, 100, "just the directories");
  assertEqual(plan.depthLimited, false, "full depth fits once files are gone");
  assertEqual(plan.tooLarge, false, "drawable");
});

test("a tree too wide at the top level is reported as too large", () => {
  // More top-level entries than the opt-in limit: nothing left to reduce.
  const tree = buildFileTree(wideRepo(OPT_IN_LIMIT + 50, 0));
  const plan = planDiagram(tree, "all");
  assertEqual(plan.tooLarge, true, "cannot be drawn at any reduction");
});

test("no plan ever exceeds the opt-in limit unless it is too large", () => {
  for (const [dirs, files] of [
    [5, 5],
    [50, 10],
    [200, 30],
    [1000, 5],
  ]) {
    const tree = buildFileTree(wideRepo(dirs, files));
    for (const mode of ["all", "directories"] as const) {
      const plan = planDiagram(tree, mode);
      assert(
        plan.tooLarge || plan.nodeCount <= OPT_IN_LIMIT,
        `plan for ${dirs}x${files} (${mode}) stays within the limit, got ${plan.nodeCount}`
      );
    }
  }
});

test("an empty tree plans to nothing and needs no confirmation", () => {
  const plan = planDiagram([], "all");
  assertEqual(plan.nodeCount, 0, "no nodes");
  assertEqual(plan.needsConfirmation, false, "nothing to confirm");
  assertEqual(plan.tooLarge, false, "not too large");
});

test("planning is deterministic", () => {
  const tree = buildFileTree(wideRepo(40, 20));
  assertEqual(planDiagram(tree, "all"), planDiagram(tree, "all"), "stable plan");
});

report("planDiagram() / countVisibleNodes() tests");
