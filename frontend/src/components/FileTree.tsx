import { useMemo, useState } from "react";
import { buildFileTree, type FileTreeNode } from "../utils/fileTree";
import type { RepositoryTreeNode } from "../types/github";

const listStyle = { listStyle: "none", paddingLeft: "1.25rem", margin: 0 };

const toggleStyle = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  cursor: "pointer",
  textAlign: "left" as const,
};

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  // Top-level entries start open; deeper directories stay collapsed so very
  // large repositories do not render tens of thousands of rows at once.
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.type === "file") {
    return <li>📄 {node.name}</li>;
  }

  return (
    <li>
      <button
        type="button"
        style={toggleStyle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "▾" : "▸"} 📁 {node.name}
      </button>
      {expanded && node.children.length > 0 && (
        <ul style={listStyle}>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ nodes }: { nodes: RepositoryTreeNode[] }) {
  // Rebuilding the nested tree is the expensive part for large
  // repositories, so it is kept out of ordinary re-renders.
  const roots = useMemo(() => buildFileTree(nodes), [nodes]);

  if (roots.length === 0) {
    return <p>This repository is empty.</p>;
  }

  return (
    <ul style={{ ...listStyle, paddingLeft: 0 }}>
      {roots.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} />
      ))}
    </ul>
  );
}
