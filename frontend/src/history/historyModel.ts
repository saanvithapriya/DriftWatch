import type { DependencyEdge, DependencyNode } from "../types/dependencies";
import type { ChangedFileStatus, ImpactEdge, ImpactNode, ImpactRelationship } from "../types/history";
import { layoutGraph, type PositionedNode } from "../dependencies/graphModel";

/**
 * Pure, framework-free helpers for the History view. No DOM, no React, no
 * network — formatting and small derivations only.
 */

/** Relative-ish, locale-aware date for a commit — falls back to the raw
 *  string if GitHub ever sends something `Date` cannot parse. */
export function formatCommitDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** First line only — commit messages routinely carry a multi-paragraph body. */
export function commitTitle(message: string): string {
  const firstLine = message.split("\n")[0];
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

const STATUS_LABELS: Record<ChangedFileStatus, string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
  renamed: "renamed",
  copied: "copied",
  changed: "changed",
  unchanged: "unchanged",
};

export function changedFileStatusLabel(status: ChangedFileStatus): string {
  return STATUS_LABELS[status] ?? "changed";
}

const RELATIONSHIP_LABELS: Record<ImpactRelationship, string> = {
  changed: "Changed",
  direct: "Directly affected",
  transitive: "Transitively affected",
  unresolved: "Unresolved",
};

/** Human label for an impact node's relationship — matches spec section 12's
 *  required vocabulary exactly ("Statically reachable" is conveyed via the
 *  Direct/Transitive distinction plus the standing disclaimer in the UI). */
export function impactRelationshipLabel(relationship: ImpactRelationship): string {
  return RELATIONSHIP_LABELS[relationship];
}

/**
 * Lays out an impact graph using Phase 4's own layered layout algorithm —
 * no second graph library, no second layout implementation. `ImpactNode`/
 * `ImpactEdge` do not structurally match `DependencyNode`/`DependencyEdge`,
 * so this adapts between the two shapes; the positions that come back are
 * then paired back up with the original impact nodes.
 */
export function layoutImpactGraph(
  nodes: readonly ImpactNode[],
  edges: readonly ImpactEdge[]
): Array<{ node: ImpactNode; x: number; y: number }> {
  const asDependencyNodes: DependencyNode[] = nodes.map((n) => ({
    id: n.id,
    path: n.path,
    label: n.path.slice(n.path.lastIndexOf("/") + 1),
    type: "file",
  }));
  const asDependencyEdges: DependencyEdge[] = edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: "internal",
  }));

  const positioned: PositionedNode[] = layoutGraph(asDependencyNodes, asDependencyEdges);
  const impactById = new Map(nodes.map((n) => [n.id, n]));

  return positioned
    .map(({ node, x, y }) => {
      const impactNode = impactById.get(node.id);
      return impactNode === undefined ? null : { node: impactNode, x, y };
    })
    .filter((v): v is { node: ImpactNode; x: number; y: number } => v !== null);
}
