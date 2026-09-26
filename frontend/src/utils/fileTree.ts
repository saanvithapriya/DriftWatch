import type { RepositoryTreeNode } from "../types/github";
import type { TreeCounts, TreeNode } from "../types/tree";

/**
 * Retained name for the UI file-tree components; the canonical domain type
 * now lives in `types/tree.ts`.
 */
export type FileTreeNode = TreeNode;

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

  return sortTree(roots);
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
