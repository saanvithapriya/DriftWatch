/**
 * Phase 2: renders a repository's file/folder structure as a Mermaid diagram.
 *
 * All Mermaid *generation* lives in `utils/mermaid.ts` and all sizing policy
 * in `utils/diagramPlan.ts`; this component owns initialisation, rendering
 * and the surrounding UI states only.
 */
import { useEffect, useMemo, useState } from "react";
import mermaid from "mermaid";
import type { TreeNode } from "../types/tree";
import { countTreeNodes } from "../utils/fileTree";
import { planDiagram, type DiagramMode } from "../utils/diagramPlan";
import { generateMermaidDiagram } from "../utils/mermaid";

let mermaidInitialised = false;

function ensureMermaidInitialised(): void {
  if (mermaidInitialised) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    // "strict" sanitises the rendered SVG. Labels come from repository
    // filenames, i.e. untrusted input, so it stays on.
    securityLevel: "strict",
    // useMaxWidth would scale a wide graph down to the card width, which
    // makes large diagrams unreadable. Keep the natural size and let the
    // wrapper scroll instead.
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
  tree: TreeNode[];
  /** Label for the diagram's root node, e.g. `facebook/react`. */
  repositoryLabel: string;
  /** True when GitHub truncated the tree this diagram was built from. */
  truncated: boolean;
}

export function RepositoryDiagram({
  tree,
  repositoryLabel,
  truncated,
}: RepositoryDiagramProps) {
  const counts = useMemo(() => countTreeNodes(tree), [tree]);

  // Very large repositories open in directory-only mode, which is both more
  // likely to fit and the more readable view at that size.
  const [mode, setMode] = useState<DiagramMode>(() =>
    planDiagram(tree, "all").tooLarge && counts.directories > 0
      ? "directories"
      : "all"
  );
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<DiagramState>({ kind: "rendering" });

  const plan = useMemo(() => planDiagram(tree, mode), [tree, mode]);

  const isEmpty = tree.length === 0;
  const awaitingConfirmation = plan.needsConfirmation && !confirmed;
  const shouldRender = !isEmpty && !plan.tooLarge && !awaitingConfirmation;

  useEffect(() => {
    if (!shouldRender) return;

    let cancelled = false;
    setState({ kind: "rendering" });

    const definition = generateMermaidDiagram(tree, {
      repositoryLabel,
      directoriesOnly: plan.directoriesOnly,
      maxDepth: plan.maxDepth,
    });

    ensureMermaidInitialised();
    const id = `repository-diagram-${(diagramCounter += 1)}`;

    mermaid
      .render(id, definition)
      .then(({ svg }) => {
        if (!cancelled) setState({ kind: "success", svg });
      })
      .catch((error: unknown) => {
        // The user gets a short message; the real error goes to the console
        // so it can be debugged.
        console.error("Mermaid failed to render the repository diagram:", error);
        if (!cancelled) setState({ kind: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [
    tree,
    repositoryLabel,
    plan.directoriesOnly,
    plan.maxDepth,
    shouldRender,
  ]);

  if (isEmpty) {
    return (
      <div className="empty-state">
        <span className="empty-state__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="empty-state__text">
          Repository has no files to visualize.
        </p>
      </div>
    );
  }

  function selectMode(next: DiagramMode): void {
    setMode(next);
    setConfirmed(false);
  }

  const modeSwitch = counts.directories > 0 && (
    <div className="diagram-toolbar">
      <div className="segmented" role="group" aria-label="Diagram detail">
        <button
          type="button"
          className={`segmented__btn${mode === "all" ? " is-active" : ""}`}
          aria-pressed={mode === "all"}
          onClick={() => selectMode("all")}
        >
          All files
        </button>
        <button
          type="button"
          className={`segmented__btn${mode === "directories" ? " is-active" : ""}`}
          aria-pressed={mode === "directories"}
          onClick={() => selectMode("directories")}
        >
          Directories only
        </button>
      </div>
      <span className="diagram-toolbar__count">
        {plan.nodeCount.toLocaleString()} of{" "}
        {(mode === "all" ? counts.total : counts.directories).toLocaleString()}{" "}
        {mode === "all" ? "nodes" : "directories"} shown
      </span>
    </div>
  );

  const truncationNotice = truncated && (
    <div className="alert alert-warning" role="alert">
      <span aria-hidden="true">⚠</span>
      <div>
        <strong className="alert-title">Incomplete repository tree</strong>
        <span className="alert-body">
          GitHub truncated the response, so this diagram may not contain every
          file.
        </span>
      </div>
    </div>
  );

  const depthNotice = plan.depthLimited && !plan.tooLarge && shouldRender && (
    <div className="alert alert-warning" role="status">
      <span aria-hidden="true">ⓘ</span>
      <div>
        <strong className="alert-title">Showing the top {plan.maxDepth} levels</strong>
        <span className="alert-body">
          The full tree is too large to draw. Use the File Tree view to explore
          every level.
        </span>
      </div>
    </div>
  );

  let body: JSX.Element;

  if (plan.tooLarge) {
    const directoriesWouldHelp = mode === "all" && counts.directories > 0;
    body = (
      <div className="diagram-placeholder">
        <span className="diagram-placeholder__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="diagram-placeholder__text">
          This repository has{" "}
          {(mode === "all"
            ? counts.total
            : counts.directories
          ).toLocaleString()}{" "}
          {mode === "all" ? "files and directories" : "directories"} — too many
          to draw as a readable diagram.{" "}
          {directoriesWouldHelp
            ? "Try “Directories only” for a structural overview, or use the File Tree view."
            : "The File Tree view still shows the complete structure."}
        </p>
      </div>
    );
  } else if (awaitingConfirmation) {
    body = (
      <div className="diagram-placeholder">
        <span className="diagram-placeholder__icon" aria-hidden="true">
          ⬡
        </span>
        <p className="diagram-placeholder__text">
          This diagram has {plan.nodeCount.toLocaleString()} nodes. Mermaid lays
          diagrams out on the main thread, so rendering it may take up to half a
          minute and will make the page unresponsive while it works.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setConfirmed(true)}
        >
          Render diagram anyway
        </button>
      </div>
    );
  } else if (state.kind === "error") {
    body = (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">
            Unable to render repository diagram.
          </strong>
          <span className="alert-body">
            The File Tree view still shows the repository structure.
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
        className="diagram-svg-wrapper"
        // mermaid.render() returns SVG it has already sanitised
        // (securityLevel: "strict"), and labels are escaped before generation.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <div className="diagram-view">
      {truncationNotice}
      {depthNotice}
      {modeSwitch}
      {body}
    </div>
  );
}
