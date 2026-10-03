import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SchemaGraphEdge, SchemaGraphNode } from "../types/schema";
import {
  SCHEMA_NODE_WIDTH,
  edgeHandleSides,
  edgeLabel,
  layoutSchemaGraph,
  modelNamesByProvider,
  relationCountsById,
} from "./schemaModel";
import { SchemaModelNode, type SchemaModelNodeData } from "./SchemaModelNode";

const nodeTypes: NodeTypes = { schemaModel: SchemaModelNode };

/** Hex twins of the `--accent` / `--text-secondary` / `--text-muted` design tokens. */
const MARKER_COLOR_ACTIVE = "#4f8ef7";
const MARKER_COLOR_INFERRED = "#8b949e";
const MARKER_COLOR_UNKNOWN = "#6e7681";
const MARKER_COLOR_EXPLICIT = "#30363d";

interface SchemaGraphViewProps {
  /** The full, unfiltered graph — layout is computed from this and only this. */
  allNodes: readonly SchemaGraphNode[];
  allEdges: readonly SchemaGraphEdge[];
  /** The subset to actually render, after search/provider/relationship filtering. */
  visibleNodes: readonly SchemaGraphNode[];
  visibleEdges: readonly SchemaGraphEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showFields: boolean;
  /** True while a non-empty search term is active, to highlight the (already-filtered) matches. */
  searchActive: boolean;
}

function FitViewButton() {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      className="btn-ghost sch-fitview-btn"
      onClick={() => fitView({ padding: 0.2, duration: 200 })}
      aria-label="Fit the whole schema graph into view"
    >
      Fit View
    </button>
  );
}

/**
 * React Flow ER-style rendering of the schema graph — the same library
 * Phase 4 already uses (spec section 15: "do not introduce another graph
 * library"), laid out with a schema-specific connected-component/BFS layout
 * (`layoutSchemaGraph`). Each model/table is a custom `SchemaModelNode` with
 * a compact field list; every label is rendered as React text, never
 * `dangerouslySetInnerHTML`.
 *
 * Layout is computed once from `allNodes`/`allEdges` — identity-stable for
 * as long as the underlying analysis hasn't changed — and reused by id
 * lookup for whatever subset `visibleNodes`/`visibleEdges` currently asks to
 * render. Search, filters, selection, and the fields toggle therefore never
 * re-run the layout algorithm itself (spec section 24).
 */
export function SchemaGraphView({
  allNodes,
  allEdges,
  visibleNodes,
  visibleEdges,
  selectedId,
  onSelect,
  showFields,
  searchActive,
}: SchemaGraphViewProps) {
  const layout = useMemo(() => layoutSchemaGraph(allNodes, allEdges), [allNodes, allEdges]);

  const positionById = useMemo(
    () => new Map(layout.map((p) => [p.node.id, { x: p.x, y: p.y }])),
    [layout]
  );
  const modelNames = useMemo(() => modelNamesByProvider(allNodes), [allNodes]);
  const relationCounts = useMemo(() => relationCountsById(allEdges), [allEdges]);
  const showMinimap = allNodes.length > 6;

  const flowNodes = useMemo<Node[]>(
    () =>
      visibleNodes.map((node) => {
        const position = positionById.get(node.id) ?? { x: 0, y: 0 };
        const data: SchemaModelNodeData = {
          node,
          selected: node.id === selectedId,
          showFields,
          modelNames: modelNames.get(node.model.sourceType) ?? new Set<string>(),
          searchActive,
          relationCount: relationCounts.get(node.id) ?? 0,
        };
        return {
          id: node.id,
          type: "schemaModel",
          position,
          style: { width: SCHEMA_NODE_WIDTH },
          data,
        };
      }),
    [visibleNodes, positionById, selectedId, showFields, modelNames, searchActive, relationCounts]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((edge) => {
        const sourcePos = positionById.get(edge.source) ?? { x: 0, y: 0 };
        const targetPos = positionById.get(edge.target) ?? { x: 0, y: 0 };
        const selfLoop = edge.source === edge.target;
        const { sourceSide, targetSide } = edgeHandleSides(sourcePos, targetPos, selfLoop);
        const { inferred } = edge.relationship;
        const unknown = edge.relationship.cardinality === "unknown";
        const active = edge.source === selectedId || edge.target === selectedId;

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: `${sourceSide}-source`,
          targetHandle: `${targetSide}-target`,
          type: "smoothstep",
          label: edgeLabel(edge.relationship),
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.92 },
          labelStyle: { fill: "var(--text-secondary)", fontSize: 10, fontWeight: 600 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: active
              ? MARKER_COLOR_ACTIVE
              : unknown
                ? MARKER_COLOR_UNKNOWN
                : inferred
                  ? MARKER_COLOR_INFERRED
                  : MARKER_COLOR_EXPLICIT,
          },
          className: [
            "sch-edge",
            unknown ? "sch-edge--unknown" : inferred ? "sch-edge--inferred" : "sch-edge--explicit",
            active ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
      }),
    [visibleEdges, positionById, selectedId]
  );

  return (
    <div className="sch-wrapper" data-testid="schema-graph">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <FitViewButton />
        </Panel>
        {showMinimap && (
          <MiniMap
            className="sch-minimap"
            pannable
            zoomable
            style={{ width: 120, height: 90 }}
            maskColor="rgba(13, 17, 23, 0.6)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
