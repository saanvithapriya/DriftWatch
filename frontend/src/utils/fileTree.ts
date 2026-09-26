import type { RepositoryTreeNode } from "../types/github";
import type { TreeCounts, TreeNode, TreeNodeCounts } from "../types/tree";

/**
 * Retained name for the UI file-tree components; the canonical domain type
 * now lives in `types/tree.ts`.
 */
export type FileTreeNode = TreeNode;

/** Path of the synthetic node that represents the repository itself. */
export const ROOT_PATH = "";

const EMPTY_COUNTS: TreeNodeCounts = {
  directFiles: 0,
  directDirectories: 0,
  totalFiles: 0,
  totalDirectories: 0,
};

function compareNodes(a: TreeNode, b: TreeNode): number {
  // Directories first, then case-insensitive alphabetical.
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort(compareNodes);
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children);
  }
  return nodes;
}

/**
 * Fills in each node's `counts` in a single post-order pass.
 *
 * Doing this once at build time means navigating the architecture view never
 * has to re-walk a subtree to show how big a directory is.
 */
function annotateCounts(nodes: TreeNode[]): TreeNodeCounts {
  const totals: TreeNodeCounts = {
    directFiles: 0,
    directDirectories: 0,
    totalFiles: 0,
    totalDirectories: 0,
  };

  for (const node of nodes) {
    if (node.type === "file") {
      node.counts = { ...EMPTY_COUNTS };
      totals.directFiles += 1;
      totals.totalFiles += 1;
      continue;
    }

    const child = annotateCounts(node.children);
    node.counts = child;

    totals.directDirectories += 1;
    totals.totalDirectories += 1 + child.totalDirectories;
    totals.totalFiles += child.totalFiles;
  }

  return totals;
}

/**
 * Turns the backend's flat, slash-separated paths into a nested tree.
 *
 * Deterministic: a path is only ever turned into one node, and siblings are
 * ordered directories-first then alphabetically, so the same input always
 * produces byte-identical output (which the Mermaid generator relies on).
 *
 * Missing intermediate segments are created as directories, so a truncated
 * response whose parent entries were cut off still renders sensibly.
 */
export function buildFileTree(
  nodes: readonly RepositoryTreeNode[]
): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  for (const node of nodes) {
    const segments = node.path.split("/").filter((s) => s !== "");
    let parentPath = "";

    segments.forEach((name, index) => {
      const path = parentPath === "" ? name : `${parentPath}/${name}`;
      const isLeaf = index === segments.length - 1;

      let current = byPath.get(path);
      if (current === undefined) {
        current = {
          name,
          path,
          // Only the final segment carries the entry's real type; anything
          // above it must be a directory.
          type: isLeaf ? node.type : "directory",
          children: [],
          counts: { ...EMPTY_COUNTS },
        };
        byPath.set(path, current);

        const parent = parentPath === "" ? undefined : byPath.get(parentPath);
        if (parent === undefined) {
          roots.push(current);
        } else {
          parent.children.push(current);
        }
      }

      parentPath = path;
    });
  }

  sortTree(roots);
  annotateCounts(roots);
  return roots;
}

/**
 * Wraps the top-level entries in a node standing for the repository itself,
 * so navigation, breadcrumbs and diagram generation have a single entry point
 * rather than special-casing a forest.
 */
export function createRepositoryRoot(
  label: string,
  children: TreeNode[]
): TreeNode {
  let totalFiles = 0;
  let totalDirectories = 0;
  let directFiles = 0;
  let directDirectories = 0;

  for (const child of children) {
    if (child.type === "file") {
      directFiles += 1;
      totalFiles += 1;
    } else {
      directDirectories += 1;
      totalDirectories += 1 + child.counts.totalDirectories;
      totalFiles += child.counts.totalFiles;
    }
  }

  return {
    name: label,
    path: ROOT_PATH,
    type: "directory",
    children,
    counts: { directFiles, directDirectories, totalFiles, totalDirectories },
  };
}

/**
 * Resolves a repository path against the tree. An empty path is the root.
 * Returns null when the path no longer exists, which is what makes navigation
 * safe across an analysis of a different repository.
 */
export function findNodeByPath(root: TreeNode, path: string): TreeNode | null {
  if (path === ROOT_PATH) return root;

  let current = root;
  for (const segment of path.split("/")) {
    if (segment === "") continue;
    const next: TreeNode | undefined = current.children.find(
      (child) => child.name === segment
    );
    if (next === undefined) return null;
    current = next;
  }
  return current;
}

/** Splits a repository path into its breadcrumb segments. */
export function pathSegments(path: string): string[] {
  return path === ROOT_PATH ? [] : path.split("/").filter((s) => s !== "");
}

/** The path of the parent directory, or null at the repository root. */
export function parentPath(path: string): string | null {
  const segments = pathSegments(path);
  if (segments.length === 0) return null;
  return segments.slice(0, -1).join("/");
}

/** Counts every node in a hierarchical tree, by kind. */
export function countTreeNodes(nodes: readonly TreeNode[]): TreeCounts {
  let files = 0;
  let directories = 0;

  const visit = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (node.type === "file") files += 1;
      else directories += 1;
      if (node.children.length > 0) visit(node.children);
    }
  };

  visit(nodes);
  return { files, directories, total: files + directories };
}
