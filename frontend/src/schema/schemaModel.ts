import type {
  SchemaCardinality,
  SchemaField,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaRelationship,
  SchemaSourceType,
} from "../types/schema";

/**
 * Pure, framework-free helpers for the Schema view (Phase 8): local search,
 * provider/relationship filtering, the ER graph layout, and the small bits of
 * node/edge display logic (flags, labels, handle sides) that are worth
 * testing without a DOM. No DOM, no React, no network — filtering and search
 * happen entirely client-side over the already-fetched analysis, never
 * issuing another GitHub request (spec sections 19/20).
 */

export interface SchemaFilterOptions {
  /** Case-insensitive, matched against model names and `Model.field` pairs. */
  search: string;
  provider: SchemaSourceType | "all";
  relationship: SchemaCardinality | "all";
}

export interface FilteredSchemaGraph {
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
}

/**
 * A node matches the search when its own name matches, or any of its
 * fields' qualified name (`Model.field`) does — so searching "user" finds
 * both the `User` model and a `Post.userId` field on an unrelated model,
 * per spec section 19's own example.
 */
export function nodeMatchesSearch(node: SchemaGraphNode, term: string): boolean {
  if (term === "") return true;
  const lower = term.toLowerCase();
  if (node.model.name.toLowerCase().includes(lower)) return true;
  return node.model.fields.some((field) =>
    `${node.model.name}.${field.name}`.toLowerCase().includes(lower)
  );
}

/**
 * Filters the graph deterministically. An edge survives only when both
 * endpoints do, and only when it also matches the relationship filter — so
 * the rendered graph never contains a dangling edge.
 */
export function filterSchemaGraph(
  nodes: readonly SchemaGraphNode[],
  edges: readonly SchemaGraphEdge[],
  options: SchemaFilterOptions
): FilteredSchemaGraph {
  const term = options.search.trim();

  const matchingNodes = nodes.filter((node) => {
    if (options.provider !== "all" && node.model.sourceType !== options.provider) return false;
    return nodeMatchesSearch(node, term);
  });
  const keptIds = new Set(matchingNodes.map((n) => n.id));

  const matchingEdges = edges.filter((edge) => {
    if (!keptIds.has(edge.source) || !keptIds.has(edge.target)) return false;
    if (options.relationship !== "all" && edge.relationship.cardinality !== options.relationship) {
      return false;
    }
    return true;
  });

  return { nodes: matchingNodes, edges: matchingEdges };
}

/** Distinct providers actually present, sorted — drives the filter's options. */
export function availableProviders(nodes: readonly SchemaGraphNode[]): SchemaSourceType[] {
  return [...new Set(nodes.map((n) => n.model.sourceType))].sort();
}

// ── Node display logic ──────────────────────────────────────────────────

export const SCHEMA_NODE_WIDTH = 260;
export const MAX_FIELDS_SHOWN_ON_NODE = 8;

const HEADER_HEIGHT = 36;
const FIELD_ROW_HEIGHT = 24;
const MORE_ROW_HEIGHT = 22;
const FOOTER_HEIGHT = 28;

/**
 * A node's rendered height, from its field count alone — never from the
 * `showFields` toggle. Layout (section 24) must stay stable when fields are
 * shown/hidden, so this always sizes as if fields are shown; toggling them
 * off just leaves a collapsed card inside the slot already reserved for it.
 */
export function estimateNodeHeight(fieldCount: number): number {
  const shown = Math.min(fieldCount, MAX_FIELDS_SHOWN_ON_NODE);
  const hasMore = fieldCount > MAX_FIELDS_SHOWN_ON_NODE;
  return HEADER_HEIGHT + shown * FIELD_ROW_HEIGHT + (hasMore ? MORE_ROW_HEIGHT : 0) + FOOTER_HEIGHT;
}

export function providerLabel(sourceType: SchemaSourceType): string {
  if (sourceType === "sql") return "SQL";
  if (sourceType === "mongoose") return "Mongoose";
  return "Prisma";
}

function baseTypeName(type: string): string {
  let t = type;
  if (t.endsWith("?")) t = t.slice(0, -1);
  if (t.endsWith("[]")) t = t.slice(0, -2);
  return t;
}

export type SchemaFieldFlag = "PK" | "FK" | "UQ" | "REQ" | "REL";

export const SCHEMA_FIELD_FLAG_TITLES: Record<SchemaFieldFlag, string> = {
  PK: "Primary key",
  FK: "Foreign key",
  UQ: "Unique",
  REQ: "Required",
  REL: "Relation to another model",
};

/**
 * Compact flags for one field (spec section 3/16). `modelNames` is the set
 * of model names declared by the *same provider*, so a Prisma `String`
 * field is never mistaken for a navigation property just because an
 * unrelated SQL table happens to share that name.
 */
export function fieldFlags(field: SchemaField, modelNames: ReadonlySet<string>): SchemaFieldFlag[] {
  const flags: SchemaFieldFlag[] = [];
  if (field.primaryKey) flags.push("PK");
  if (field.references !== undefined) flags.push("FK");
  if (field.unique) flags.push("UQ");
  if (!field.primaryKey && field.required === true) flags.push("REQ");
  if (!field.primaryKey && field.references === undefined && modelNames.has(baseTypeName(field.type))) {
    flags.push("REL");
  }
  return flags;
}

/** Model names grouped by provider, so relation-field detection never crosses providers. */
export function modelNamesByProvider(
  nodes: readonly SchemaGraphNode[]
): Map<SchemaSourceType, Set<string>> {
  const map = new Map<SchemaSourceType, Set<string>>();
  for (const node of nodes) {
    let set = map.get(node.model.sourceType);
    if (set === undefined) {
      set = new Set();
      map.set(node.model.sourceType, set);
    }
    set.add(node.model.name);
  }
  return map;
}

/** How many distinct relationships touch each node (either end), for the node footer. */
export function relationCountsById(edges: readonly SchemaGraphEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const edge of edges) {
    bump(edge.source);
    if (edge.target !== edge.source) bump(edge.target);
  }
  return counts;
}

// ── Edge display logic ──────────────────────────────────────────────────

/** Compact edge label (spec section 7): the cardinality, or "?" when unknown — never fabricated. */
export function edgeLabel(relationship: SchemaRelationship): string {
  return relationship.cardinality === "unknown" ? "?" : relationship.cardinality;
}

export type HandleSide = "top" | "right" | "bottom" | "left";

/**
 * Which side of each node an edge should leave/enter from, so relationships
 * route around nodes instead of all converging on one central point (spec
 * section 5). Chosen from the two nodes' relative layout position — the
 * larger of the two axis deltas decides whether the edge is predominantly
 * horizontal or vertical. A self-relation always loops from the top to the
 * right side of the same node.
 */
export function edgeHandleSides(
  source: { x: number; y: number },
  target: { x: number; y: number },
  selfLoop: boolean
): { sourceSide: HandleSide; targetSide: HandleSide } {
  if (selfLoop) return { sourceSide: "top", targetSide: "right" };

  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { sourceSide: "right", targetSide: "left" } : { sourceSide: "left", targetSide: "right" };
  }
  return dy >= 0 ? { sourceSide: "bottom", targetSide: "top" } : { sourceSide: "top", targetSide: "bottom" };
}

// ── Layout ───────────────────────────────────────────────────────────────

export interface PositionedSchemaNode {
  node: SchemaGraphNode;
  x: number;
  y: number;
}

/** Horizontal distance between BFS layers (node width + room for edges/labels). */
const COLUMN_WIDTH = SCHEMA_NODE_WIDTH + 100;
/** Vertical gap between stacked nodes within one layer. */
const ROW_GAP = 32;
/** Gap between separate connected components when they are tiled. */
const COMPONENT_GAP_X = 140;
const COMPONENT_GAP_Y = 100;
/** Components wrap onto a new row once a row reaches roughly this width. */
const MAX_ROW_WIDTH = 1700;

interface ComponentLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  size: number;
  firstId: string;
}

/**
 * Lays out the schema graph as a set of connected components, each drawn as
 * a hub-centered, BFS-layered diagram, then tiles the components left to
 * right (wrapping into new rows) so the result uses the available
 * horizontal space instead of one long vertical chain (spec sections 9/10).
 *
 * Deterministic throughout: every tie (root choice, layer order, component
 * order) breaks on node id, so the same graph always produces the same
 * coordinates. Relationships are treated as undirected for the purpose of
 * grouping and layering — an ER diagram's shape should not depend on which
 * side of a `1:N` happens to be "source".
 */
export function layoutSchemaGraph(
  nodes: readonly SchemaGraphNode[],
  edges: readonly SchemaGraphEdge[]
): PositionedSchemaNode[] {
  const ids = nodes.map((n) => n.id).sort();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const heightById = new Map(nodes.map((n) => [n.id, estimateNodeHeight(n.model.fields.length)]));

  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  // Connected components via flood fill. Isolated nodes form their own
  // singleton component, so a schema with no relationships still lays out
  // as a tidy grid rather than nothing at all.
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const id of ids) {
    if (componentOf.has(id)) continue;
    const stack = [id];
    componentOf.set(id, componentCount);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!componentOf.has(neighbor)) {
          componentOf.set(neighbor, componentCount);
          stack.push(neighbor);
        }
      }
    }
    componentCount += 1;
  }

  const membersByComponent = new Map<number, string[]>();
  for (const id of ids) {
    const c = componentOf.get(id) ?? 0;
    const bucket = membersByComponent.get(c);
    if (bucket === undefined) membersByComponent.set(c, [id]);
    else bucket.push(id);
  }

  const componentLayouts: ComponentLayout[] = [];

  for (const memberIds of membersByComponent.values()) {
    memberIds.sort();

    // Root = highest-degree node, so the most connected model anchors the
    // component's first layer rather than an arbitrary one.
    let root = memberIds[0];
    let bestDegree = -1;
    for (const id of memberIds) {
      const degree = adjacency.get(id)?.size ?? 0;
      if (degree > bestDegree) {
        bestDegree = degree;
        root = id;
      }
    }

    const layerOf = new Map<string, number>();
    const layers: string[][] = [[root]];
    layerOf.set(root, 0);
    const queue: string[] = [root];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentLayer = layerOf.get(current) ?? 0;
      const neighbors = [...(adjacency.get(current) ?? [])].sort();
      for (const neighbor of neighbors) {
        if (layerOf.has(neighbor)) continue;
        layerOf.set(neighbor, currentLayer + 1);
        if (layers[currentLayer + 1] === undefined) layers[currentLayer + 1] = [];
        layers[currentLayer + 1].push(neighbor);
        queue.push(neighbor);
      }
    }

    // Defensive: every member of this component is reachable from the root
    // by construction (that is what "component" means), so this never
    // actually fires — it just guarantees every id gets a layer either way.
    for (const id of memberIds) {
      if (!layerOf.has(id)) {
        const last = layers.length;
        layerOf.set(id, last);
        if (layers[last] === undefined) layers[last] = [];
        layers[last].push(id);
      }
    }

    // Order each layer by the average row-position of its already-placed
    // parents (a single-pass barycenter heuristic) to reduce edge crossings
    // between adjacent layers, breaking ties on id for determinism.
    const rowIndexInLayer = new Map<string, number>([[root, 0]]);
    for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
      const layerNodes = layers[layerIndex] ?? [];
      const scored = layerNodes.map((id) => {
        const parents = [...(adjacency.get(id) ?? [])].filter(
          (n) => layerOf.get(n) === layerIndex - 1
        );
        const rows = parents.map((p) => rowIndexInLayer.get(p) ?? 0);
        const avg = rows.length > 0 ? rows.reduce((a, b) => a + b, 0) / rows.length : 0;
        return { id, avg };
      });
      scored.sort((a, b) => a.avg - b.avg || (a.id < b.id ? -1 : 1));
      scored.forEach((entry, index) => rowIndexInLayer.set(entry.id, index));
      layers[layerIndex] = scored.map((entry) => entry.id);
    }

    // Stack nodes within each layer by their real (field-count-aware)
    // height, then center shorter layers against the tallest one so the
    // component reads as one balanced block rather than top-aligned columns.
    const localPositions = new Map<string, { x: number; y: number }>();
    const layerHeights: number[] = [];

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layerNodes = layers[layerIndex] ?? [];
      let cursorY = 0;
      for (const id of layerNodes) {
        localPositions.set(id, { x: layerIndex * COLUMN_WIDTH, y: cursorY });
        cursorY += (heightById.get(id) ?? 160) + ROW_GAP;
      }
      layerHeights.push(Math.max(0, cursorY - ROW_GAP));
    }

    const componentHeight = Math.max(0, ...layerHeights);
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const offset = (componentHeight - (layerHeights[layerIndex] ?? 0)) / 2;
      for (const id of layers[layerIndex] ?? []) {
        const pos = localPositions.get(id);
        if (pos !== undefined) pos.y += offset;
      }
    }

    const componentWidth =
      layers.length > 0 ? (layers.length - 1) * COLUMN_WIDTH + SCHEMA_NODE_WIDTH : SCHEMA_NODE_WIDTH;

    componentLayouts.push({
      positions: localPositions,
      width: componentWidth,
      height: componentHeight,
      size: memberIds.length,
      firstId: memberIds[0],
    });
  }

  // Largest components first, deterministically tie-broken, then packed
  // left to right in shelves so the overall graph uses horizontal space
  // instead of growing into one tall column.
  componentLayouts.sort((a, b) => b.size - a.size || (a.firstId < b.firstId ? -1 : 1));

  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;
  const result: PositionedSchemaNode[] = [];

  for (const component of componentLayouts) {
    if (cursorX > 0 && cursorX + component.width > MAX_ROW_WIDTH) {
      rowY += rowHeight + COMPONENT_GAP_Y;
      cursorX = 0;
      rowHeight = 0;
    }
    for (const [id, pos] of component.positions) {
      const node = nodeById.get(id);
      if (node === undefined) continue;
      result.push({ node, x: cursorX + pos.x, y: rowY + pos.y });
    }
    cursorX += component.width + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, component.height);
  }

  return result;
}
