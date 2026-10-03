import type { DependencyEdge, DependencyNode } from "../types/dependencies";

/**
 * Largest graph React Flow is asked to render.
 *
 * Above this the view refuses to draw and asks for a filter instead, rather
 * than silently showing an arbitrary subset. Chosen so panning and selection
 * stay smooth; the backend may legitimately return a larger graph.
 */
export const MAX_DEPENDENCY_GRAPH_NODES = 200;

export interface PositionedNode {
  node: DependencyNode;
  x: number;
  y: number;
}

export interface GraphNeighbours {
  /** Files this file imports. */
  dependencies: string[];
  /** Files that import this file. */
  dependents: string[];
}

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 74;

/**
 * Assigns each node a layer, then a position within it.
 *
 * Layering is a Kahn-style longest-path pass: a node sits one layer to the
 * right of everything that imports it. Cycles have no valid topological
 * order, so any node still unplaced once the queue drains is assigned to the
 * layer after its deepest placed dependent. That terminates in one pass —
 * there is no recursion that a dependency cycle could send round forever.
 *
 * Deterministic: nodes are processed in id order and positions derive only
 * from layer and index.
 */
export function layoutGraph(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[]
): PositionedNode[] {
  const ids = [...nodes].map((n) => n.id).sort();
  const known = new Set(ids);

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const edge of [...edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  const remainingIncoming = new Map<string, number>();
  for (const id of ids) {
    remainingIncoming.set(id, incoming.get(id)?.length ?? 0);
  }

  const layer = new Map<string, number>();
  const queue: string[] = ids.filter((id) => remainingIncoming.get(id) === 0);
  for (const id of queue) layer.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const currentLayer = layer.get(id) ?? 0;

    for (const target of outgoing.get(id) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, currentLayer + 1));
      const left = (remainingIncoming.get(target) ?? 0) - 1;
      remainingIncoming.set(target, left);
      if (left === 0) queue.push(target);
    }
  }

  // Anything left is inside a cycle: place it after its deepest placed
  // dependent so the edges still read left-to-right where possible.
  for (const id of ids) {
    if (layer.has(id)) continue;
    let deepest = 0;
    for (const source of incoming.get(id) ?? []) {
      const sourceLayer = layer.get(source);
      if (sourceLayer !== undefined) deepest = Math.max(deepest, sourceLayer + 1);
    }
    layer.set(id, deepest);
  }

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const index = layer.get(id) ?? 0;
    const bucket = byLayer.get(index);
    if (bucket === undefined) byLayer.set(index, [id]);
    else bucket.push(id);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const positioned: PositionedNode[] = [];

  for (const [layerIndex, bucket] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    bucket.sort();
    bucket.forEach((id, rowIndex) => {
      const node = nodeById.get(id);
      if (node === undefined) return;
      positioned.push({
        node,
        x: layerIndex * COLUMN_WIDTH,
        y: rowIndex * ROW_HEIGHT,
      });
    });
  }

  return positioned;
}

/** Direct dependencies and dependents of one file, sorted. */
export function neighboursOf(
  id: string,
  edges: readonly DependencyEdge[]
): GraphNeighbours {
  const dependencies: string[] = [];
  const dependents: string[] = [];

  for (const edge of edges) {
    if (edge.source === id) dependencies.push(edge.target);
    if (edge.target === id) dependents.push(edge.source);
  }

  return { dependencies: dependencies.sort(), dependents: dependents.sort() };
}

export interface FilterOptions {
  /** Case-insensitive substring matched against the full path. */
  search: string;
  /**
   * When set, keeps the selected file plus everything directly connected to
   * it, so a single file's neighbourhood can be inspected.
   */
  focusId?: string | null;
}

export interface FilteredGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/**
 * Applies search and focus to the graph, deterministically.
 *
 * An edge survives only when both of its endpoints do, so the rendered graph
 * never contains a dangling edge. Order is preserved from the (already
 * sorted) input.
 */
export function filterGraph(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[],
  options: FilterOptions
): FilteredGraph {
  const term = options.search.trim().toLowerCase();
  let kept = new Set(nodes.map((n) => n.id));

  if (term !== "") {
    kept = new Set(
      nodes.filter((n) => n.path.toLowerCase().includes(term)).map((n) => n.id)
    );
  }

  if (options.focusId != null) {
    const focus = options.focusId;
    const neighbourhood = new Set<string>([focus]);
    for (const edge of edges) {
      if (edge.source === focus) neighbourhood.add(edge.target);
      if (edge.target === focus) neighbourhood.add(edge.source);
    }
    kept = new Set([...kept].filter((id) => neighbourhood.has(id)));
    // The focused file always belongs in its own neighbourhood.
    kept.add(focus);
  }

  return {
    nodes: nodes.filter((n) => kept.has(n.id)),
    edges: edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
  };
}

/** Distinct top-level directories present in the graph, sorted. */
export function topLevelDirectories(nodes: readonly DependencyNode[]): string[] {
  const directories = new Set<string>();
  for (const node of nodes) {
    const index = node.path.indexOf("/");
    if (index > 0) directories.add(node.path.slice(0, index));
  }
  return [...directories].sort();
}
