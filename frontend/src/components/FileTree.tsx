import { useMemo, useState } from "react";
import { buildFileTree, type FileTreeNode } from "../utils/fileTree";
import type { RepositoryTreeNode } from "../types/github";

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.type === "file") {
    return (
      <li className="ftree-item ftree-item--file">
        <span className="ftree-icon" aria-hidden="true">📄</span>
        <span className="ftree-name">{node.name}</span>
      </li>
    );
  }

  return (
    <li className="ftree-item ftree-item--dir">
      <button
        type="button"
        className="ftree-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="ftree-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="ftree-icon" aria-hidden="true">📁</span>
        <span className="ftree-name">{node.name}</span>
      </button>
      {expanded && node.children.length > 0 && (
        <ul className="ftree-list ftree-list--nested">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ nodes }: { nodes: RepositoryTreeNode[] }) {
  const roots = useMemo(() => buildFileTree(nodes), [nodes]);

  if (roots.length === 0) {
    return (
      <p className="ftree-empty">This repository appears to be empty.</p>
    );
  }

  return (
    <ul className="ftree-list ftree-list--root">
      {roots.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} />
      ))}
    </ul>
  );
}
