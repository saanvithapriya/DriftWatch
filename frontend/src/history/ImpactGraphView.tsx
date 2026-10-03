import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ImpactEdge, ImpactNode } from "../types/history";
import { impactRelationshipLabel, layoutImpactGraph } from "./historyModel";

interface ImpactGraphViewProps {
  nodes: readonly ImpactNode[];
  edges: readonly ImpactEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * React Flow rendering of the impact graph — the same library Phase 4
 * already uses for the dependency graph, per spec section 20 ("do not
 * introduce another graph library"), laid out with Phase 4's own layered
 * layout algorithm (`layoutImpactGraph`, which adapts to it rather than
 * duplicating it).
 *
 * Nodes are colour-coded by relationship (changed / directly affected /
 * transitively affected / unresolved) via CSS classes only — every label is
 * rendered as React text, never through `dangerouslySetInnerHTML`.
 */
export function ImpactGraphView({ nodes, edges, selectedId, onSelect }: ImpactGraphViewProps) {
  const flowNodes = useMemo<Node[]>(() => {
    return layoutImpactGraph(nodes, edges).map(({ node, x, y }) => ({
      id: node.id,
      position: { x, y },
      // Explicit dimensions, rather than auto-sizing to the label's content:
      // with graphs up to `MAX_GRAPH_NODES` large, `fitView` can zoom out far
      // enough that an auto-sized node's DOM box and its painted position
      // drift apart by the time a click is handled, making the node
      // unreliable to click precisely. A fixed size keeps React Flow's own
      // layout bookkeeping (used for hit-testing and edge anchoring) exactly
      // in sync with what is drawn, at any zoom level.
      width: 140,
      height: 28,
      data: {
        label: (
          <span
            className={`hx-impact-node hx-impact-node--${node.relationship}${
              node.id === selectedId ? " is-selected" : ""
            }`}
            title={`${node.path} — ${impactRelationshipLabel(node.relationship)}`}
          >
            {node.path.slice(node.path.lastIndexOf("/") + 1)}
          </span>
        ),
      },
      className: "depflow-node",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));
  }, [nodes, edges, selectedId]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        // source depends on (imports) target — the same direction Phase 4 uses.
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: edge.source === selectedId || edge.target === selectedId,
        className:
          edge.source === selectedId || edge.target === selectedId
            ? "depflow-edge is-active"
            : "depflow-edge",
      })),
    [edges, selectedId]
  );

  return (
    <div className="hx-impact-wrapper" data-testid="impact-graph">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
