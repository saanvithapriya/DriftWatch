import type {
  CallGraphEdge,
  CallGraphFunctionNode,
  CallGraphTruncationReason,
} from "../types/callGraph.js";
import type { CallGraphIndex } from "./callGraphBuilder.js";
import { toFunctionNode } from "./callGraphBuilder.js";

/**
 * Breadth-first reachability from one entry point.
 *
 * BFS rather than DFS specifically because "maximum depth" needs to mean
 * shortest number of hops from the entry point — BFS visits in depth order,
 * so a node is only ever discovered once, at its true minimum depth, and the
 * traversal can stop cleanly the moment a limit is reached.
 *
 * Cycle-safe by construction: a node already in the `visited` set is never
 * re-queued, so `a -> b -> a` and direct self-recursion (`factorial ->
 * factorial`) both terminate, contributing at most one node and one edge
 * each. Nothing here is randomized or depends on `Map`/object iteration
 * order — the adjacency lists handed in are already sorted deterministically
 * by `callGraphBuilder.ts`.
 */

export const MAX_CALL_GRAPH_NODES = 100;
export const MAX_CALL_GRAPH_DEPTH = 10;

export interface TraversalResult {
  nodes: CallGraphFunctionNode[];
  edges: CallGraphEdge[];
  maxDepth: number;
  truncated: boolean;
  truncationReason?: CallGraphTruncationReason;
}

export interface TraversalOptions {
  maxNodes?: number;
  maxDepth?: number;
}

export function traverseCallGraph(
  index: CallGraphIndex,
  entryFunctionId: string,
  options: TraversalOptions = {}
): TraversalResult {
  const maxNodes = options.maxNodes ?? MAX_CALL_GRAPH_NODES;
  const maxDepth = options.maxDepth ?? MAX_CALL_GRAPH_DEPTH;

  const entry = index.functionsById.get(entryFunctionId);
  if (entry === undefined) {
    return { nodes: [], edges: [], maxDepth: 0, truncated: false };
  }

  const visited = new Set<string>([entryFunctionId]);
  const depthOf = new Map<string, number>([[entryFunctionId, 0]]);
  const queue: string[] = [entryFunctionId];
  const resultEdges: CallGraphEdge[] = [];

  let truncatedNodes = false;
  let truncatedDepth = false;
  let reachedMaxDepth = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const depth = depthOf.get(current) as number;

    for (const edge of index.adjacency.get(current) ?? []) {
      if (visited.has(edge.target)) {
        // A cycle or a diamond: the node is already part of the graph, but
        // this specific edge into it has not been recorded yet.
        resultEdges.push(edge);
        continue;
      }

      if (depth + 1 > maxDepth) {
        truncatedDepth = true;
        continue;
      }
      if (visited.size >= maxNodes) {
        truncatedNodes = true;
        continue;
      }

      visited.add(edge.target);
      depthOf.set(edge.target, depth + 1);
      reachedMaxDepth = Math.max(reachedMaxDepth, depth + 1);
      queue.push(edge.target);
      resultEdges.push(edge);
    }
  }

  const nodes = [...visited]
    .map((id) => index.functionsById.get(id))
    .filter((fn): fn is NonNullable<typeof fn> => fn !== undefined)
    .map(toFunctionNode)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  resultEdges.sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0
  );

  const truncated = truncatedNodes || truncatedDepth;
  const truncationReason: CallGraphTruncationReason | undefined = truncatedNodes
    ? "max_nodes"
    : truncatedDepth
      ? "max_depth"
      : undefined;

  return {
    nodes,
    edges: resultEdges,
    maxDepth: reachedMaxDepth,
    truncated,
    ...(truncationReason !== undefined ? { truncationReason } : {}),
  };
}

/**
 * Deterministic default entry point (spec section 9), applied only when the
 * caller did not choose one explicitly:
 *
 *   1. an exported function named `main`
 *   2. any function named `main`
 *   3. a default-exported function
 *   4. the first function, by sorted id
 *
 * Returns null when the repository has no statically extractable functions
 * at all — never invents one.
 */
export function selectDefaultEntryPoint(index: CallGraphIndex): string | null {
  if (index.allFunctions.length === 0) return null;

  const exportedMain = index.allFunctions.find((fn) => fn.name === "main" && fn.exported);
  if (exportedMain !== undefined) return exportedMain.id;

  const anyMain = index.allFunctions.find((fn) => fn.name === "main");
  if (anyMain !== undefined) return anyMain.id;

  const defaultExported = index.allFunctions.find((fn) => fn.isDefaultExport);
  if (defaultExported !== undefined) return defaultExported.id;

  return index.allFunctions[0].id;
}
