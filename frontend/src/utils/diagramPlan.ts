/**
 * Decides how much of a repository tree can reasonably be drawn.
 *
 * Mermaid lays a graph out synchronously on the main thread, so an unbounded
 * diagram does not merely render slowly — it freezes the tab. The limits below
 * come from measuring real renders in Chromium on this project:
 *
 *   100 nodes  ->  ~3.4s
 *   200 nodes  ->  ~6.9s
 *   300 nodes  -> ~15.3s
 *   400 nodes  -> ~21.8s
 *   500 nodes  -> ~32.8s
 *   700 nodes  -> never completes; Mermaid itself gives up
 *
 * So anything past a few hundred nodes has to be opted into, and past ~500 the
 * view is reduced (directories only, then depth-limited) until it fits.
 */
import type { TreeNode } from "../types/tree";

/** Renders quickly enough to draw without asking. */
export const AUTO_RENDER_LIMIT = 150;
/** The largest diagram worth attempting, and only on an explicit request. */
export const OPT_IN_LIMIT = 500;

export type DiagramMode = "all" | "directories";

export interface DiagramPlan {
  directoriesOnly: boolean;
  /** Undefined means the whole depth of the tree is drawn. */
  maxDepth?: number;
  /** How many nodes this plan will draw, excluding the repository root. */
  nodeCount: number;
  /** The diagram is big enough that the user should choose to render it. */
  needsConfirmation: boolean;
  /** True when depth had to be capped to make the diagram fit. */
  depthLimited: boolean;
  /** True when even the most reduced view is still too big to draw. */
  tooLarge: boolean;
}

export interface VisibleNodeOptions {
  directoriesOnly?: boolean;
  maxDepth?: number;
}

/** Counts the nodes a given set of diagram options would actually draw. */
export function countVisibleNodes(
  nodes: readonly TreeNode[],
  options: VisibleNodeOptions = {}
): number {
  const { directoriesOnly = false, maxDepth } = options;
  let count = 0;

  const visit = (list: readonly TreeNode[], depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    for (const node of list) {
      if (directoriesOnly && node.type === "file") continue;
      count += 1;
      if (node.children.length > 0) visit(node.children, depth + 1);
    }
  };

  visit(nodes, 1);
  return count;
}

// Tried in order once the full tree is too large.
const DEPTH_LADDER = [6, 5, 4, 3, 2, 1];

/**
 * Picks the most detailed view of `nodes` that stays within `OPT_IN_LIMIT`,
 * reducing depth only when the full tree does not fit.
 */
export function planDiagram(
  nodes: readonly TreeNode[],
  mode: DiagramMode
): DiagramPlan {
  const directoriesOnly = mode === "directories";

  const candidates: Array<number | undefined> = [undefined, ...DEPTH_LADDER];

  for (const maxDepth of candidates) {
    const nodeCount = countVisibleNodes(nodes, { directoriesOnly, maxDepth });
    if (nodeCount <= OPT_IN_LIMIT) {
      return {
        directoriesOnly,
        maxDepth,
        nodeCount,
        needsConfirmation: nodeCount > AUTO_RENDER_LIMIT,
        depthLimited: maxDepth !== undefined,
        tooLarge: false,
      };
    }
  }

  // More than OPT_IN_LIMIT entries at the very top level: nothing to reduce.
  return {
    directoriesOnly,
    maxDepth: 1,
    nodeCount: countVisibleNodes(nodes, { directoriesOnly, maxDepth: 1 }),
    needsConfirmation: true,
    depthLimited: true,
    tooLarge: true,
  };
}
