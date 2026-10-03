import { useEffect, useMemo, useState } from "react";
import type { CallGraphEntryPoint, CallGraphFunctionNode } from "../types/callGraph";
import { nextDiagramId, renderMermaid } from "../utils/mermaidRender";
import {
  MAX_CALL_FLOW_DIAGRAM_NODES,
  generateCallGraphDiagram,
} from "./callGraphMermaid";
import type { UseCallGraphAnalysisResult } from "./useCallGraphAnalysis";

type DiagramState =
  | { kind: "rendering" }
  | { kind: "success"; svg: string }
  | { kind: "error" };

interface CallFlowExplorerProps {
  /** Analysis state owned by the parent, so revisiting this tab never refetches. */
  state: UseCallGraphAnalysisResult;
}

function groupByFile(
  entries: readonly CallGraphEntryPoint[]
): Map<string, CallGraphEntryPoint[]> {
  const byFile = new Map<string, CallGraphEntryPoint[]>();
  for (const entry of entries) {
    let list = byFile.get(entry.file);
    if (list === undefined) {
      list = [];
      byFile.set(entry.file, list);
    }
    list.push(entry);
  }
  for (const list of byFile.values()) list.sort((a, b) => a.startLine - b.startLine);
  return byFile;
}

function truncationMessage(reason: string | undefined): string {
  if (reason === "max_nodes") {
    return "The reachable call graph has more functions than can be shown at once; some are not included.";
  }
  if (reason === "max_depth") {
    return "The call graph goes deeper than can be shown at once; calls beyond that depth are not included.";
  }
  return "An analysis limit was reached, so this view does not cover the whole repository.";
}

/**
 * Phase 6 Call Flow explorer.
 *
 * Shows the statically inferred calls reachable from one entry-point
 * function, as a Mermaid sequence diagram, plus per-function details and
 * summary statistics. This is static source analysis — it is never runtime
 * tracing, and no repository code is ever executed to produce it.
 */
export function CallFlowExplorer({ state }: CallFlowExplorerProps) {
  const { status, analysis, error, selectEntryPoint } = state;

  const [diagram, setDiagram] = useState<DiagramState>({ kind: "rendering" });
  const [selectedFunctionId, setSelectedFunctionId] = useState<string | null>(null);
  const [draftFile, setDraftFile] = useState<string | null>(null);
  const [draftFunctionId, setDraftFunctionId] = useState<string | null>(null);

  const availableEntryPoints = analysis?.availableEntryPoints ?? [];
  const byFile = useMemo(() => groupByFile(availableEntryPoints), [availableEntryPoints]);
  const files = useMemo(() => [...byFile.keys()].sort(), [byFile]);

  const currentEntryFile = analysis?.entryPoint?.file ?? null;
  const currentEntryFunctionId = analysis?.entryPoint?.functionId ?? null;

  // Seeds the two selectors from whatever was actually analyzed, so they
  // reflect reality (including the backend's own default choice) rather than
  // staying empty until the user picks something.
  useEffect(() => {
    if (currentEntryFile !== null) setDraftFile(currentEntryFile);
    if (currentEntryFunctionId !== null) setDraftFunctionId(currentEntryFunctionId);
  }, [currentEntryFile, currentEntryFunctionId]);

  useEffect(() => {
    setSelectedFunctionId(currentEntryFunctionId);
  }, [currentEntryFunctionId]);

  const draftFileFunctions = draftFile !== null ? byFile.get(draftFile) ?? [] : [];

  function handleFileChange(file: string): void {
    setDraftFile(file);
    const first = byFile.get(file)?.[0];
    setDraftFunctionId(first?.id ?? null);
  }

  function handleAnalyze(): void {
    if (draftFunctionId !== null) selectEntryPoint(draftFunctionId);
  }

  const graph = useMemo(
    () => (analysis === null ? null : generateCallGraphDiagram(analysis.nodes, analysis.edges)),
    [analysis]
  );

  useEffect(() => {
    if (graph === null || graph.definition === null) return;

    let cancelled = false;
    setDiagram({ kind: "rendering" });

    renderMermaid(nextDiagramId("call-flow-diagram"), graph.definition)
      .then((svg) => {
        if (!cancelled) setDiagram({ kind: "success", svg });
      })
      .catch((caught: unknown) => {
        // The user gets a short message; the real error goes to the console.
        // A Mermaid failure must never unmount the application.
        console.error("Mermaid failed to render the call flow diagram:", caught);
        if (!cancelled) setDiagram({ kind: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [graph]);

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Reading source files…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to analyze call flow</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (analysis === null) return null;

  if (analysis.entryPoint === null) {
    return (
      <div className="empty-state" data-testid="call-flow-empty">
        <span className="empty-state__icon" aria-hidden="true">
          🔍
        </span>
        <p className="empty-state__text">
          This repository has no statically extractable functions in
          <code> .js</code>, <code>.jsx</code>, <code>.ts</code> or{" "}
          <code>.tsx</code> files.
        </p>
      </div>
    );
  }

  const selectedFunction: CallGraphFunctionNode | null =
    analysis.nodes.find((n) => n.id === selectedFunctionId) ?? null;

  return (
    <div className="wf" data-testid="call-flow-explorer">
      {analysis.truncated && (
        <div className="alert alert-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Partial call flow</strong>
            <span className="alert-body">{truncationMessage(analysis.truncationReason)}</span>
          </div>
        </div>
      )}

      <div className="wf-toolbar">
        <label className="toggle" htmlFor="call-flow-file-select">
          Entry File
          <select
            id="call-flow-file-select"
            className="select"
            value={draftFile ?? ""}
            onChange={(e) => handleFileChange(e.target.value)}
          >
            {files.map((file) => (
              <option key={file} value={file}>
                {file}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle" htmlFor="call-flow-function-select">
          Entry Function
          <select
            id="call-flow-function-select"
            className="select"
            value={draftFunctionId ?? ""}
            onChange={(e) => setDraftFunctionId(e.target.value)}
          >
            {draftFileFunctions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {fn.name} (line {fn.startLine})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleAnalyze}
          disabled={draftFunctionId === null}
        >
          Analyze Call Flow
        </button>
      </div>

      <p className="wf-toolbar__count" data-testid="call-flow-stats">
        Functions discovered: {analysis.stats.functionsDiscovered} · Reachable:{" "}
        {analysis.stats.functionsReachable} · Calls: {analysis.stats.edges} · Unresolved:{" "}
        {analysis.stats.unresolvedCalls} · External: {analysis.stats.externalCalls} · Max depth:{" "}
        {analysis.stats.maxDepth}
      </p>

      {graph !== null && graph.exceededMaxNodes ? (
        <div className="diagram-placeholder">
          <span className="diagram-placeholder__icon" aria-hidden="true">
            🔀
          </span>
          <p className="diagram-placeholder__text">
            This call graph has {graph.nodeCount} functions, more than the{" "}
            {MAX_CALL_FLOW_DIAGRAM_NODES} that can be drawn at once. Pick a function below to
            inspect it.
          </p>
        </div>
      ) : graph === null || graph.definition === null ? (
        <div className="diagram-placeholder">
          <p className="diagram-placeholder__text">
            {selectedFunction?.displayName ?? "This function"} makes no statically resolved calls.
          </p>
        </div>
      ) : diagram.kind === "error" ? (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Unable to render this call flow diagram.</strong>
            <span className="alert-body">The function list below still shows the graph.</span>
          </div>
        </div>
      ) : diagram.kind === "rendering" ? (
        <div className="diagram-placeholder">
          <span className="spinner spinner--large" aria-hidden="true" />
          <p className="diagram-placeholder__text">Rendering diagram…</p>
        </div>
      ) : (
        <div
          className="diagram-svg-wrapper"
          data-testid="call-flow-diagram"
          // mermaid.render() returns SVG it has already sanitised
          // (securityLevel: "strict"); labels are escaped beforehand.
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      )}

      {analysis.nodes.length > 0 && (
        <>
          <p className="diagram-hint">Select a function below to see its details.</p>
          <div className="wf-jobs" role="group" aria-label="Functions in this call flow">
            {analysis.nodes.map((fn) => (
              <button
                key={fn.id}
                type="button"
                className={`wf-jobchip${fn.id === selectedFunctionId ? " is-active" : ""}`}
                aria-pressed={fn.id === selectedFunctionId}
                onClick={() => setSelectedFunctionId(fn.id)}
              >
                {fn.displayName}
              </button>
            ))}
          </div>
        </>
      )}

      {selectedFunction !== null && (
        <div className="wf-details card" data-testid="call-flow-function-details">
          <h4 className="wf-details__name">{selectedFunction.displayName}</h4>
          <dl className="wf-details__meta">
            <div>
              <dt>File</dt>
              <dd>
                <code>{selectedFunction.file}</code>
              </dd>
            </div>
            <div>
              <dt>Lines</dt>
              <dd>
                {selectedFunction.startLine}–{selectedFunction.endLine}
              </dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{selectedFunction.kind}</dd>
            </div>
            <div>
              <dt>Exported</dt>
              <dd>{selectedFunction.exported ? "yes" : "no"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
