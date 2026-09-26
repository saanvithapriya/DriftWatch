/**
 * Phase 2: the repository architecture explorer.
 *
 * Rather than drawing the whole repository as one graph, this shows one
 * directory at a time and lets the user drill down. All navigation is local:
 * it re-reads the already-fetched tree and never issues a request.
 *
 * Diagram *generation* lives in `utils/mermaid.ts`; this component owns
 * Mermaid initialisation, rendering, and the surrounding UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import type { TreeNode } from "../types/tree";
import { ROOT_PATH, findNodeByPath, parentPath, pathSegments } from "../utils/fileTree";
import {
  MAX_DIAGRAM_NODES,
  describeDirectory,
  generateMermaidDiagram,
} from "../utils/mermaid";

let mermaidInitialised = false;

function ensureMermaidInitialised(): void {
  if (mermaidInitialised) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    // "strict" sanitises the rendered SVG. Labels come from repository
    // filenames, i.e. untrusted input, so it stays on.
    securityLevel: "strict",
    // useMaxWidth would scale a wide graph down to the card width, which makes
    // diagrams unreadable. Keep the natural size and let the wrapper scroll.
    flowchart: { htmlLabels: false, useMaxWidth: false },
  });
  mermaidInitialised = true;
}

let diagramCounter = 0;

type DiagramState =
  | { kind: "rendering" }
  | { kind: "success"; svg: string }
  | { kind: "error" };

interface RepositoryDiagramProps {
  /** The synthetic node representing the repository. */
  root: TreeNode;
  /** Currently selected directory path ("" is the repository root). */
  currentPath: string;
  onNavigate: (path: string) => void;
  /** True when GitHub truncated the tree this diagram was built from. */
  truncated: boolean;
}

export function RepositoryDiagram({
  root,
  currentPath,
  onNavigate,
  truncated,
}: RepositoryDiagramProps) {
  const [showFiles, setShowFiles] = useState(false);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [state, setState] = useState<DiagramState>({ kind: "rendering" });
  const containerRef = useRef<HTMLDivElement>(null);

  // A path that no longer exists (after analyzing a different repository)
  // falls back to the root instead of rendering nothing.
  const current = useMemo(
    () => findNodeByPath(root, currentPath) ?? root,
    [root, currentPath]
  );

  const diagram = useMemo(
    () => generateMermaidDiagram(current, { showFiles, depth }),
    [current, showFiles, depth]
  );

  const isEmptyRepository = root.children.length === 0;

  useEffect(() => {
    if (isEmptyRepository || diagram.definition === null) return;

    let cancelled = false;
    setState({ kind: "rendering" });

    ensureMermaidInitialised();
    diagramCounter += 1;
    const id = `repository-diagram-${diagramCounter}`;

    mermaid
      .render(id, diagram.definition)
      .then(({ svg }) => {
        if (!cancelled) setState({ kind: "success", svg });
      })
      .catch((error: unknown) => {
        // The user gets a short message; the real error goes to the console
        // so it can be debugged. A Mermaid failure must never propagate and
        // unmount the application.
        console.error("Mermaid failed to render the repository diagram:", error);
        if (!cancelled) setState({ kind: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [diagram, isEmptyRepository]);

  /**
   * Mermaid gives each node an element id like `flowchart-node_3-7`, so the
   * generator's id is recovered from the middle of that.
   */
  const handleDiagramClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as Element | null;
      const nodeEl = target?.closest?.("[id]") as Element | null;
      if (nodeEl === null || nodeEl === undefined) return;

      const match = /(?:^|-)(node_\d+|root)(?:-\d+)?$/.exec(nodeEl.id);
      const generatedId = match?.[1];
      if (generatedId === undefined) return;

      const path = diagram.pathsById.get(generatedId);
      if (path === undefined || path === current.path) return;

      const node = findNodeByPath(root, path);
      if (node === null || node.type !== "directory") return;
      onNavigate(path);
    },
    [diagram, current.path, root, onNavigate]
  );

  if (isEmptyRepository) {
    return (
      <div className="empty-state">
        <span className="empty-state__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="empty-state__text">
          This repository has no files to visualize.
        </p>
      </div>
    );
  }

  const segments = pathSegments(current.path);
  const up = parentPath(current.path);

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Diagram location">
      <button
        type="button"
        className="breadcrumb__crumb"
        onClick={() => onNavigate(ROOT_PATH)}
        disabled={current.path === ROOT_PATH}
      >
        {root.name}
      </button>
      {segments.map((segment, index) => (
        <span key={segments.slice(0, index + 1).join("/")} className="breadcrumb__part">
          <span className="breadcrumb__sep" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            className="breadcrumb__crumb"
            onClick={() => onNavigate(segments.slice(0, index + 1).join("/"))}
            disabled={index === segments.length - 1}
          >
            {segment}
          </button>
        </span>
      ))}
    </nav>
  );

  const toolbar = (
    <div className="diagram-toolbar">
      <div className="diagram-toolbar__group">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => up !== null && onNavigate(up)}
          disabled={up === null}
        >
          ↑ Up
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showFiles}
            onChange={(e) => setShowFiles(e.target.checked)}
          />
          Show files
        </label>
        <label className="toggle">
          Depth
          <select
            className="select"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value) === 2 ? 2 : 1)}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>
      <span className="diagram-toolbar__count">
        {describeDirectory(current)} · {diagram.nodeCount} shown
      </span>
    </div>
  );

  const truncationNotice = truncated && (
    <div className="alert alert-warning" role="alert">
      <span aria-hidden="true">⚠</span>
      <div>
        <strong className="alert-title">Incomplete repository tree</strong>
        <span className="alert-body">
          GitHub truncated the response, so some files may not be shown.
        </span>
      </div>
    </div>
  );

  let body: JSX.Element;

  if (diagram.exceededMaxNodes) {
    body = (
      <div className="diagram-placeholder">
        <span className="diagram-placeholder__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="diagram-placeholder__text">
          This directory contains {diagram.nodeCount.toLocaleString()} items,
          too many to render as one diagram (the limit is{" "}
          {MAX_DIAGRAM_NODES}). Use the File Tree, or select a subdirectory to
          explore further.
        </p>
      </div>
    );
  } else if (diagram.nodeCount === 0) {
    body = (
      <div className="diagram-placeholder">
        <span className="diagram-placeholder__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="diagram-placeholder__text">
          {showFiles
            ? "This directory is empty."
            : "This directory contains no subdirectories. Turn on “Show files” to see its contents."}
        </p>
      </div>
    );
  } else if (state.kind === "error") {
    body = (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to render this diagram.</strong>
          <span className="alert-body">
            Try opening a smaller directory or using the File Tree view.
          </span>
        </div>
      </div>
    );
  } else if (state.kind === "rendering") {
    body = (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Rendering diagram…</p>
      </div>
    );
  } else {
    body = (
      <div
        ref={containerRef}
        className="diagram-svg-wrapper"
        onClick={handleDiagramClick}
        // mermaid.render() returns SVG it has already sanitised
        // (securityLevel: "strict"), and labels are escaped before generation.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <div className="diagram-view">
      {truncationNotice}
      {breadcrumb}
      {toolbar}
      <p className="diagram-hint">
        Click a directory in the diagram to drill into it.
      </p>
      {body}
    </div>
  );
}
