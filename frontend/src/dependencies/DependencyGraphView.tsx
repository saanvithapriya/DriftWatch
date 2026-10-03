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
import type { DependencyEdge, DependencyNode } from "../types/dependencies";
import { layoutGraph } from "./graphModel";

interface DependencyGraphViewProps {
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * React Flow rendering of the dependency graph.
 *
 * Nodes are compact — a filename and its directory, never file contents — and
 * every label is rendered as text by React Flow. Repository-controlled strings
 * are never passed through `dangerouslySetInnerHTML`.
 */
export function DependencyGraphView({
  nodes,
  edges,
  selectedId,
  onSelect,
}: DependencyGraphViewProps) {
  const flowNodes = useMemo<Node[]>(() => {
    return layoutGraph(nodes, edges).map(({ node, x, y }) => {
      const directory = node.path.slice(0, node.path.lastIndexOf("/"));
      return {
        id: node.id,
        position: { x, y },
        data: {
          label: (
            <span className="depnode">
              <span className="depnode__name">{node.label}</span>
              {directory !== "" && (
                <span className="depnode__dir">{directory}</span>
              )}
            </span>
          ),
        },
        className: node.id === selectedId ? "depflow-node is-selected" : "depflow-node",
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    });
  }, [nodes, edges, selectedId]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // source -> target means "source imports target".
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
    <div className="depflow" data-testid="dependency-graph">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        // A tall graph would otherwise be zoomed out until the labels are
        // unreadable. The floor keeps nodes legible and the user pans instead.
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
