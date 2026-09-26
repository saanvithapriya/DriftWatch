import { useState } from "react";
import type { TreeNode } from "../types/tree";

interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  onOpenInDiagram?: (path: string) => void;
}

function TreeNodeRow({ node, depth, onOpenInDiagram }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.type === "file") {
    return (
      <li className="ftree-item ftree-item--file">
        <span className="ftree-icon" aria-hidden="true">
          📄
        </span>
        <span className="ftree-name">{node.name}</span>
      </li>
    );
  }

  return (
    <li className="ftree-item ftree-item--dir">
      <span className="ftree-row">
        <button
          type="button"
          className="ftree-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="ftree-chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="ftree-icon" aria-hidden="true">
            📁
          </span>
          <span className="ftree-name">{node.name}</span>
        </button>
        {onOpenInDiagram !== undefined && (
          <button
            type="button"
            className="ftree-open"
            title={`Open ${node.name} in the architecture view`}
            aria-label={`Open ${node.name} in the architecture view`}
            onClick={() => onOpenInDiagram(node.path)}
          >
            ⬡
          </button>
        )}
      </span>
      {expanded && node.children.length > 0 && (
        <ul className="ftree-list ftree-list--nested">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenInDiagram={onOpenInDiagram}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface FileTreeProps {
  /** Top-level nodes of the repository hierarchy. */
  nodes: TreeNode[];
  /** When provided, directories gain a shortcut into the architecture view. */
  onOpenInDiagram?: (path: string) => void;
}

export function FileTree({ nodes, onOpenInDiagram }: FileTreeProps) {
  if (nodes.length === 0) {
    return <p className="ftree-empty">This repository appears to be empty.</p>;
  }

  return (
    <ul className="ftree-list ftree-list--root">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          onOpenInDiagram={onOpenInDiagram}
        />
      ))}
    </ul>
  );
}
