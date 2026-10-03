import type { DependencyGraph } from "../types/dependencies.js";
import type {
  ChangedFile,
  ImpactEdge,
  ImpactNode,
  ImpactRelationship,
  ImpactStats,
  ImpactTruncationReason,
} from "../types/history.js";

/**
 * Pure reverse-dependency impact traversal (spec sections 10–13).
 *
 * Deliberately separate from `impactService.ts`, exactly the way Phase 6
 * splits `callGraphBuilder.ts` (build the graph) from `callGraphTraversal.ts`
 * (traverse it) — this function touches no network and no GitHub client, so
 * it can be tested directly with a synthetic dependency graph.
 *
 * `graph` is Phase 4's own `buildDependencyGraph` output, used entirely
 * as-is; this module only reads its edges and never recomputes a dependency
 * relationship itself.
 */

export const STANDARD_WARNING =
  "Impact analysis is based on statically resolved dependencies and may not capture dynamic runtime relationships.";

const UNRESOLVED_CHANGED_WARNING =
  "Some changed files are not part of the static dependency graph (not a supported source file, or removed), so their dependents cannot be statically determined.";

export interface ImpactTraversalResult {
  changedFiles: string[];
  affectedFiles: string[];
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  stats: ImpactStats;
  warnings: string[];
  truncated: boolean;
  truncationReason?: ImpactTruncationReason;
}

/**
 * Breadth-first reverse-dependency traversal from a set of changed files.
 *
 * `graph.edges` are `source -> target` meaning "source imports target"
 * (Phase 4's own convention). Reversing that adjacency gives, for any file,
 * every file that imports it — i.e. its dependents, which is what "impact"
 * means here: if a file changes, everything that depends on it may be
 * affected.
 *
 * Cycle-safe and deterministic by construction, the same way
 * `callGraphTraversal.ts` is: a node is only ever enqueued once (first
 * discovery wins), so a dependency cycle contributes a bounded number of
 * nodes and edges rather than looping forever, and the multi-source queue is
 * processed in the already-sorted order the caller seeds it with.
 */
export function computeImpactGraph(
  graph: DependencyGraph,
  changedFiles: readonly ChangedFile[],
  maxDepth: number,
  maxFiles: number
): ImpactTraversalResult {
  const reverseAdjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    let list = reverseAdjacency.get(edge.target);
    if (list === undefined) {
      list = [];
      reverseAdjacency.set(edge.target, list);
    }
    list.push(edge.source);
  }
  for (const list of reverseAdjacency.values()) list.sort();

  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));

  const nodes = new Map<string, ImpactNode>();
  const edges = new Map<string, ImpactEdge>();
  let truncatedByNodes = false;
  let truncatedByDepth = false;
  let anyUnresolvedChanged = false;

  const changedPaths = [...new Set(changedFiles.map((f) => f.path))].sort();
  const statusByPath = new Map(changedFiles.map((f) => [f.path, f.status]));

  const queue: Array<{ id: string; depth: number }> = [];
  for (const path of changedPaths) {
    const inGraph = graphNodeIds.has(path);
    if (!inGraph) anyUnresolvedChanged = true;

    const relationship: ImpactRelationship = inGraph ? "changed" : "unresolved";
    nodes.set(path, {
      id: path,
      path,
      relationship,
      depth: 0,
      changeStatus: statusByPath.get(path),
    });
    if (inGraph) queue.push({ id: path, depth: 0 });
  }

  let maxDepthReached = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { id, depth } = queue[cursor];

    for (const dependent of reverseAdjacency.get(id) ?? []) {
      const alreadyKnown = nodes.has(dependent);

      if (alreadyKnown) {
        const edgeKey = `${dependent}->${id}`;
        if (!edges.has(edgeKey)) edges.set(edgeKey, { source: dependent, target: id });
        continue;
      }

      if (depth + 1 > maxDepth) {
        truncatedByDepth = true;
        continue;
      }
      if (nodes.size >= maxFiles) {
        truncatedByNodes = true;
        continue;
      }

      const nextDepth = depth + 1;
      maxDepthReached = Math.max(maxDepthReached, nextDepth);
      nodes.set(dependent, {
        id: dependent,
        path: dependent,
        relationship: nextDepth === 1 ? "direct" : "transitive",
        depth: nextDepth,
      });
      edges.set(`${dependent}->${id}`, { source: dependent, target: id });
      queue.push({ id: dependent, depth: nextDepth });
    }
  }

  const affectedFiles = [...nodes.values()]
    .filter((n) => n.relationship === "direct" || n.relationship === "transitive")
    .map((n) => n.path)
    .sort();

  const truncated = truncatedByNodes || truncatedByDepth;
  const truncationReason: ImpactTruncationReason | undefined = truncatedByNodes
    ? "max_files"
    : truncatedByDepth
      ? "max_depth"
      : undefined;

  const warnings: string[] = [];
  if (truncated) warnings.push(STANDARD_WARNING);
  if (anyUnresolvedChanged) {
    warnings.push(UNRESOLVED_CHANGED_WARNING);
    if (!truncated) warnings.push(STANDARD_WARNING);
  }

  return {
    changedFiles: changedPaths,
    affectedFiles,
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...edges.values()].sort((a, b) =>
      a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0
    ),
    stats: {
      changedFiles: changedPaths.length,
      affectedFiles: affectedFiles.length,
      maxDepth: maxDepthReached,
    },
    warnings,
    truncated,
    ...(truncationReason !== undefined ? { truncationReason } : {}),
  };
}
