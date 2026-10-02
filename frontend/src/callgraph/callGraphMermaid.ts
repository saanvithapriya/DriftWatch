import type { CallGraphEdge, CallGraphFunctionNode } from "../types/callGraph";
import { escapeLabel } from "../utils/mermaid";

/**
 * Mermaid `sequenceDiagram` generation for a call graph.
 *
 * Pure: no DOM, no React, no network. Function names and call-site text are
 * repository-controlled and therefore untrusted, so every label passes
 * through the shared `escapeLabel` (the same entity-code escaping the
 * architecture and CI/CD diagrams use) and participant ids are always
 * sequential (`function_1`, `function_2`, …) — never derived from source
 * text — so a malicious name can inject neither a new Mermaid directive nor
 * markup into the rendered SVG (`mermaid.render` also runs with
 * `securityLevel: "strict"`, sanitising the output regardless).
 *
 * A sequence diagram has no native notion of a cycle or of branching the way
 * a flowchart does — it is just an ordered list of messages between
 * participants. Nodes and edges arrive already sorted deterministically from
 * the backend, and are emitted in that same order, so a cyclic or recursive
 * call graph still renders (a repeated message, or a self-message) without
 * looping forever; this diagram shows *what calls what*, not the order calls
 * would happen in at runtime — Call Flow is static, not a runtime trace.
 */

/** Defense in depth: the backend already caps a traversal at 100 nodes
 *  (`MAX_CALL_GRAPH_NODES`), but the diagram never assumes that promise. */
export const MAX_CALL_FLOW_DIAGRAM_NODES = 100;

export interface CallGraphDiagram {
  /** Mermaid source, or null when there is nothing to draw or the guard tripped. */
  definition: string | null;
  nodeCount: number;
  exceededMaxNodes: boolean;
  /** Mermaid participant id -> function id, so the UI can make them clickable. */
  functionIdByParticipantId: Map<string, string>;
}

export function generateCallGraphDiagram(
  nodes: readonly CallGraphFunctionNode[],
  edges: readonly CallGraphEdge[],
  maxNodes: number = MAX_CALL_FLOW_DIAGRAM_NODES
): CallGraphDiagram {
  const functionIdByParticipantId = new Map<string, string>();

  if (nodes.length === 0) {
    return { definition: null, nodeCount: 0, exceededMaxNodes: false, functionIdByParticipantId };
  }

  if (nodes.length > maxNodes) {
    return {
      definition: null,
      nodeCount: nodes.length,
      exceededMaxNodes: true,
      functionIdByParticipantId,
    };
  }

  const participantIdByFunctionId = new Map<string, string>();
  nodes.forEach((node, index) => {
    const participantId = `function_${index + 1}`;
    participantIdByFunctionId.set(node.id, participantId);
    functionIdByParticipantId.set(participantId, node.id);
  });

  const lines: string[] = ["sequenceDiagram"];

  for (const node of nodes) {
    const participantId = participantIdByFunctionId.get(node.id) as string;
    lines.push(`  participant ${participantId} as "${escapeLabel(node.displayName)}"`);
  }

  for (const edge of edges) {
    const sourceId = participantIdByFunctionId.get(edge.source);
    const targetId = participantIdByFunctionId.get(edge.target);
    // Both endpoints of every edge are always among `nodes` for a graph that
    // came from the backend's own traversal, but a defensive check costs
    // nothing and keeps this generator honest about not inventing a
    // participant for a dangling reference.
    if (sourceId === undefined || targetId === undefined) continue;

    const label = escapeLabel(
      edge.callCount > 1 ? `${edge.callExpression} ×${edge.callCount}` : edge.callExpression
    );
    lines.push(`  ${sourceId}->>${targetId}: "${label}"`);
  }

  return {
    definition: lines.join("\n"),
    nodeCount: nodes.length,
    exceededMaxNodes: false,
    functionIdByParticipantId,
  };
}
