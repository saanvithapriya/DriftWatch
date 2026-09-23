/**
 * Phase 2: Renders a repository's file/folder structure as a Mermaid diagram.
 *
 * Props:
 *   tree     – hierarchical TreeNode[] from the data contract
 *   status   – mirrors the parent's loading state so we reuse Phase 1 UI
 *
 * NOTE: The Mermaid generation logic (treeToMermaid) is NOT changed here.
 * Only the inline styles have been replaced with CSS class names to fit
 * the dark-themed design system. All diagram logic is preserved exactly.
 */
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { treeToMermaid, type TreeNode } from "../utils/mermaid";

// ── Mermaid is initialised once per page load ──────────────
let mermaidInitialised = false;

function ensureMermaidInitialised(): void {
  if (mermaidInitialised) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
  });
  mermaidInitialised = true;
}

// Rough heuristic: >300 nodes may cause the SVG renderer to struggle.
const NODE_LIMIT = 300;

function countAllNodes(tree: TreeNode[]): number {
  let total = 0;
  for (const node of tree) {
    total += 1;
    if (node.children) total += countAllNodes(node.children);
  }
  return total;
}

type DiagramState =
  | { kind: "idle" }
  | { kind: "rendering" }
  | { kind: "success"; svg: string }
  | { kind: "too-large" }
  | { kind: "error"; message: string };

interface RepositoryDiagramProps {
  tree: TreeNode[] | null;
  status: "idle" | "loading" | "success" | "error";
}

let diagramCounter = 0;

export function RepositoryDiagram({ tree, status }: RepositoryDiagramProps) {
  const [diagram, setDiagram] = useState<DiagramState>({ kind: "idle" });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "idle" || status === "error") {
      setDiagram({ kind: "idle" });
      return;
    }

    if (status === "loading") {
      setDiagram({ kind: "rendering" });
      return;
    }

    // status === "success"
    if (!tree || tree.length === 0) {
      setDiagram({ kind: "idle" });
      return;
    }

    const nodeCount = countAllNodes(tree);
    if (nodeCount > NODE_LIMIT) {
      setDiagram({ kind: "too-large" });
      return;
    }

    ensureMermaidInitialised();

    const definition = treeToMermaid(tree);
    const id = `mermaid-diagram-${++diagramCounter}`;

    setDiagram({ kind: "rendering" });

    mermaid
      .render(id, definition)
      .then(({ svg }) => {
        setDiagram({ kind: "success", svg });
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : "Could not render the repository diagram.";
        setDiagram({ kind: "error", message });
      });
  }, [tree, status]);

  // ── UI states ─────────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Rendering diagram…</p>
      </div>
    );
  }

  if (status === "error") return null;

  // success branch
  if (!tree || tree.length === 0) {
    return (
      <p className="diagram-placeholder__text">
        No files found in this repository.
      </p>
    );
  }

  if (diagram.kind === "too-large") {
    return (
      <div className="diagram-placeholder">
        <span className="diagram-placeholder__icon" aria-hidden="true">⬡</span>
        <p className="diagram-placeholder__text">
          This repository is too large to display as a diagram (over {NODE_LIMIT} nodes).
          The file tree below still shows the full structure.
        </p>
      </div>
    );
  }

  if (diagram.kind === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Diagram could not be rendered</strong>
          <span className="alert-body">
            The file tree below still shows the repository structure.
          </span>
        </div>
      </div>
    );
  }

  if (diagram.kind === "rendering" || diagram.kind === "idle") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Building diagram…</p>
      </div>
    );
  }

  // Success — inject the sanitised SVG from mermaid.render()
  return (
    <div
      ref={containerRef}
      className="diagram-svg-wrapper"
      // mermaid.render returns sanitised SVG; dangerouslySetInnerHTML is
      // intentional and safe (securityLevel:"loose" already strips scripts).
      dangerouslySetInnerHTML={{ __html: diagram.svg }}
    />
  );
}
