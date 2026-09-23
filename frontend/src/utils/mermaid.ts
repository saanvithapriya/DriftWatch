/**
 * Phase 2: Mermaid diagram generation utility.
 *
 * Pure function — no API calls, no side effects.
 */

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

/**
 * Converts a path to a stable, unique Mermaid node ID.
 *
 * Rules:
 * - Replace any character that is NOT alphanumeric or underscore with `_`
 * - Prefix with `n_` so the ID always starts with a letter (prevents Mermaid
 *   from rejecting IDs that start with a digit)
 *
 * The result is deterministic: same path → same ID.
 */
function pathToId(path: string): string {
  return "n_" + path.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Escapes characters that Mermaid treats as special inside node labels.
 *
 * We wrap labels in double-quotes in the generated diagram, so the only
 * characters we need to handle are double-quote itself and the backslash
 * (which is Mermaid's escape character for some renderers).
 */
function escapeLabel(label: string): string {
  return label
    .replace(/\\/g, "\\\\")   // backslash first
    .replace(/"/g, '\\"');     // then double-quote
}

/**
 * Recursively walks the tree and appends node definitions and edges to the
 * provided arrays.  Node definitions are de-duplicated via `seen`.
 */
function walk(
  nodes: TreeNode[],
  lines: string[],
  seen: Set<string>
): void {
  for (const node of nodes) {
    const id = pathToId(node.path);
    const label = escapeLabel(node.name);

    // Emit the node definition only once (guard against duplicate paths).
    if (!seen.has(id)) {
      seen.add(id);
      if (node.type === "directory") {
        // Rounded rectangle  →  id("label")
        lines.push(`  ${id}("📁 ${label}")`);
      } else {
        // Rectangle  →  id["label"]
        lines.push(`  ${id}["📄 ${label}"]`);
      }
    }

    // Recurse into children and emit edges parent → child.
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childId = pathToId(child.path);
        lines.push(`  ${id} --> ${childId}`);
      }
      walk(node.children, lines, seen);
    }
  }
}

/**
 * Converts a hierarchical `TreeNode[]` into a Mermaid `graph TD` string.
 *
 * - Returns `"graph TD"` (a valid but empty diagram) for an empty tree.
 * - Node IDs are derived from `path`, not array indexes, so output is
 *   deterministic across re-runs.
 * - Directories use rounded-rectangle nodes; files use rectangle nodes.
 */
export function treeToMermaid(tree: TreeNode[]): string {
  if (tree.length === 0) {
    return "graph TD";
  }

  const lines: string[] = ["graph TD"];
  const seen = new Set<string>();

  walk(tree, lines, seen);

  return lines.join("\n");
}
