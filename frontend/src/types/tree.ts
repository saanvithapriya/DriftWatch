/**
 * Hierarchical repository tree — the application's own domain shape.
 *
 * Phase 1 hands back a flat list of paths; everything that visualizes the
 * repository works from this nested form instead. It is deliberately
 * independent of Octokit and of the wire format in `types/github.ts`.
 */

export interface TreeNodeCounts {
  /** Children directly inside this node. */
  directFiles: number;
  directDirectories: number;
  /** Everything beneath this node, at any depth. */
  totalFiles: number;
  totalDirectories: number;
}

export interface TreeNode {
  /** Final path segment, e.g. `Header.tsx`. Empty for the repository root. */
  name: string;
  /** Full path from the repository root, e.g. `src/components/Header.tsx`. */
  path: string;
  type: "file" | "directory";
  /** Always present; empty for files and for empty directories. */
  children: TreeNode[];
  /**
   * Size metadata, computed once when the tree is built so the UI never has
   * to walk the subtree again while the user navigates.
   */
  counts: TreeNodeCounts;
}

export interface TreeCounts {
  files: number;
  directories: number;
  total: number;
}
