/**
 * Phase 2: Mermaid diagram generation.
 *
 * Pure functions — no DOM, no API calls, no side effects. Given the same
 * tree and options these always produce byte-identical output.
 */
import type { TreeNode } from "../types/tree";

export type { TreeNode };

export interface MermaidDiagramOptions {
  /** Label for the root node, e.g. `facebook/react`. */
  repositoryLabel: string;
  /**
   * Omit file nodes and draw only the directory skeleton. Used to keep very
   * large repositories renderable.
   */
  directoriesOnly?: boolean;
  /**
   * Stop descending past this depth (1 = the repository's immediate children).
   * Undefined draws the whole tree.
   */
  maxDepth?: number;
}

const ROOT_ID = "root";

/**
 * Makes a label safe to place inside a double-quoted Mermaid node label.
 *
 * Mermaid renders labels as HTML, so `<`, `>` and `&` would otherwise be
 * parsed as markup, and `"` would end the label early. Mermaid's own escape
 * mechanism is the entity code (`#NN;` / `#name;`), so `#` has to be escaped
 * first — otherwise the `#` characters introduced by the later replacements
 * would themselves be re-escaped and the output would be corrupted.
 *
 * Everything else the spec lists — [ ] ( ) { } | : ; / \ ' — is inert inside
 * a quoted label and is deliberately left alone so filenames stay readable.
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

/**
 * Converts a hierarchical tree into a Mermaid `graph TD` diagram rooted at a
 * node representing the repository itself.
 *
 * Node IDs are sequential (`node_1`, `node_2`, …) rather than derived from the
 * path. Deriving an ID by substituting unsafe characters is not injective:
 * `a-b.txt`, `a_b.txt` and `a.b.txt` would all collapse onto one ID and two of
 * the three files would silently disappear from the diagram. Allocation order
 * follows the tree's deterministic ordering, so IDs remain stable across runs.
 */
export function generateMermaidDiagram(
  tree: readonly TreeNode[],
  options: MermaidDiagramOptions
): string {
  const lines: string[] = ["graph TD"];
  lines.push(`  ${ROOT_ID}(["${escapeLabel(options.repositoryLabel)}"])`);

  const directoriesOnly = options.directoriesOnly === true;
  const { maxDepth } = options;
  const idsByPath = new Map<string, string>();
  const definedIds = new Set<string>();
  const emittedEdges = new Set<string>();

  const idFor = (path: string): string => {
    const existing = idsByPath.get(path);
    if (existing !== undefined) return existing;
    const id = `node_${idsByPath.size + 1}`;
    idsByPath.set(path, id);
    return id;
  };

  const walk = (
    nodes: readonly TreeNode[],
    parentId: string,
    depth: number
  ): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;

    for (const node of nodes) {
      if (directoriesOnly && node.type === "file") continue;

      const id = idFor(node.path);
      const label = escapeLabel(node.name);

      // A well-formed tree holds each path once, but guard anyway so a
      // malformed tree cannot emit a duplicate definition.
      if (!definedIds.has(id)) {
        definedIds.add(id);
        lines.push(
          node.type === "directory"
            ? `  ${id}("📁 ${label}")`
            : `  ${id}["📄 ${label}"]`
        );
      }

      const edge = `  ${parentId} --> ${id}`;
      if (!emittedEdges.has(edge)) {
        emittedEdges.add(edge);
        lines.push(edge);
      }

      if (node.children.length > 0) walk(node.children, id, depth + 1);
    }
  };

  walk(tree, ROOT_ID, 1);

  return lines.join("\n");
}
