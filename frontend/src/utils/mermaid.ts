/**
 * Phase 2: Mermaid diagram generation for the architecture explorer.
 *
 * The generator draws ONE level of the repository at a time: the selected
 * directory, plus its immediate children (optionally one level deeper). It
 * never walks the whole repository, which is what keeps diagrams small enough
 * for Mermaid to lay out quickly.
 *
 * Pure functions — no DOM, no API calls, no React state.
 */
import type { TreeNode } from "../types/tree";

export type { TreeNode };

/**
 * Upper bound on nodes in a single diagram.
 *
 * Measured Mermaid layout cost in Chromium (it lays out synchronously on the
 * main thread, so this is freeze time, not just slowness):
 *
 *   100 nodes -> ~3.4s     300 -> ~15.3s     500 -> ~32.8s     700 -> never completes
 *
 * Drawing one level at a time normally keeps diagrams far below this; the
 * guard exists for directories with an unusually large number of children.
 */
export const MAX_DIAGRAM_NODES = 150;

export interface DiagramOptions {
  /** Include file children, not just directories. */
  showFiles: boolean;
  /** Safety guard; defaults to MAX_DIAGRAM_NODES. */
  maxNodes?: number;
  /** 1 = immediate children only (default), 2 = one level deeper. */
  depth?: 1 | 2;
}

export interface MermaidDiagram {
  /** Mermaid source, or null when the guard tripped. */
  definition: string | null;
  /** Nodes that would be drawn, excluding the node itself. */
  nodeCount: number;
  /** True when `nodeCount` exceeded the guard and nothing was generated. */
  exceededMaxNodes: boolean;
  /** Mermaid node id -> repository path, so the UI can make nodes clickable. */
  pathsById: Map<string, string>;
}

const ROOT_ID = "root";

/**
 * Makes a label safe to place inside a double-quoted Mermaid node label.
 *
 * Mermaid's own escape mechanism is the entity code (`#NN;` / `#name;`), so
 * `#` has to be escaped first — otherwise the `#` characters introduced by the
 * later replacements would themselves be re-escaped and the output corrupted.
 *
 * Everything else the spec lists — [ ] ( ) { } | : ; / \ ' — is inert inside a
 * quoted label and is deliberately left alone so filenames stay readable.
 */
export function escapeLabel(label: string): string {
  return label
    .replace(/#/g, "#35;")
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/[\r\n]+/g, " ");
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Compact size summary for a directory, e.g. `32 dirs · 248 files`. */
export function describeDirectory(node: TreeNode): string {
  const { totalDirectories, totalFiles } = node.counts;
  const parts: string[] = [];
  if (totalDirectories > 0) {
    parts.push(plural(totalDirectories, "dir", "dirs"));
  }
  parts.push(plural(totalFiles, "file", "files"));
  return parts.join(" · ");
}

function childrenToDraw(
  node: TreeNode,
  showFiles: boolean
): TreeNode[] {
  return showFiles
    ? node.children
    : node.children.filter((child) => child.type === "directory");
}

/**
 * Counts what a given node and options would draw, without building the
 * diagram. Used by the guard before any Mermaid work happens.
 */
export function countDiagramNodes(
  node: TreeNode,
  options: DiagramOptions
): number {
  const depth = options.depth ?? 1;
  const first = childrenToDraw(node, options.showFiles);
  if (depth === 1) return first.length;

  let total = first.length;
  for (const child of first) {
    if (child.type === "directory") {
      total += childrenToDraw(child, options.showFiles).length;
    }
  }
  return total;
}

/**
 * Builds the diagram for a single directory.
 *
 * The supplied node becomes the diagram's root; only its children (and, at
 * depth 2, its grandchildren) are drawn. Node IDs are sequential rather than
 * derived from the path: deriving an ID by replacing unsafe characters is not
 * injective, so `a-b.txt`, `a_b.txt` and `a.b.txt` would collapse onto one ID
 * and files would silently vanish. Allocation follows the tree's deterministic
 * ordering, so IDs are stable across runs.
 */
export function generateMermaidDiagram(
  node: TreeNode,
  options: DiagramOptions
): MermaidDiagram {
  const maxNodes = options.maxNodes ?? MAX_DIAGRAM_NODES;
  const depth = options.depth ?? 1;
  const pathsById = new Map<string, string>();

  const nodeCount = countDiagramNodes(node, options);
  if (nodeCount > maxNodes) {
    return { definition: null, nodeCount, exceededMaxNodes: true, pathsById };
  }

  const lines: string[] = ["graph TD"];
  const rootLabel =
    node.type === "directory"
      ? `${escapeLabel(node.name)}<br/>${escapeLabel(describeDirectory(node))}`
      : escapeLabel(node.name);
  lines.push(`  ${ROOT_ID}(["${rootLabel}"])`);
  pathsById.set(ROOT_ID, node.path);

  let counter = 0;
  const idFor = (path: string): string => {
    counter += 1;
    const id = `node_${counter}`;
    pathsById.set(id, path);
    return id;
  };

  const emit = (parentId: string, child: TreeNode): string => {
    const id = idFor(child.path);
    if (child.type === "directory") {
      const label = `${escapeLabel(child.name)}<br/>${escapeLabel(describeDirectory(child))}`;
      lines.push(`  ${id}("📁 ${label}")`);
    } else {
      lines.push(`  ${id}["📄 ${escapeLabel(child.name)}"]`);
    }
    lines.push(`  ${parentId} --> ${id}`);
    return id;
  };

  for (const child of childrenToDraw(node, options.showFiles)) {
    const childId = emit(ROOT_ID, child);
    if (depth === 2 && child.type === "directory") {
      for (const grandchild of childrenToDraw(child, options.showFiles)) {
        emit(childId, grandchild);
      }
    }
  }

  return {
    definition: lines.join("\n"),
    nodeCount,
    exceededMaxNodes: false,
    pathsById,
  };
}
