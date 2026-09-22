import type { RepositoryTreeNode } from "../types/github";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: FileTreeNode[];
}

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  // Directories first, then case-insensitive alphabetical.
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  nodes.sort(compareNodes);
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children);
  }
  return nodes;
}

/**
 * Turns the backend's flat, slash-separated paths into a nested tree.
 *
 * Missing intermediate segments are created as directories, so a truncated
 * response whose parent entries were cut off still renders sensibly.
 */
export function buildFileTree(
  nodes: readonly RepositoryTreeNode[]
): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const byPath = new Map<string, FileTreeNode>();

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
