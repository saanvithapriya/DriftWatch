import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workflow, WorkflowJob, WorkflowTrigger } from "../types/workflows";
import { nextDiagramId, renderMermaid } from "../utils/mermaidRender";
import {
  MAX_WORKFLOW_GRAPH_NODES,
  generateWorkflowDiagram,
} from "./workflowMermaid";
import type { WorkflowAnalysisState } from "./useWorkflowAnalysis";

type DiagramState =
  | { kind: "rendering" }
  | { kind: "success"; svg: string }
  | { kind: "error" };

interface WorkflowExplorerProps {
  /** Analysis state owned by the parent, so revisiting this tab never refetches. */
  state: WorkflowAnalysisState;
}

/** Human-readable summary of one trigger, including its filters. */
function describeTrigger(trigger: WorkflowTrigger): string {
  const parts: string[] = [];
  if (trigger.branches !== undefined) parts.push(`branches: ${trigger.branches.join(", ")}`);
  if (trigger.branchesIgnore !== undefined) parts.push(`ignore: ${trigger.branchesIgnore.join(", ")}`);
  if (trigger.tags !== undefined) parts.push(`tags: ${trigger.tags.join(", ")}`);
  if (trigger.paths !== undefined) parts.push(`paths: ${trigger.paths.join(", ")}`);
  if (trigger.types !== undefined) parts.push(`types: ${trigger.types.join(", ")}`);
  if (trigger.cron !== undefined) parts.push(trigger.cron.join(" · "));
  return parts.join(" · ");
}

/**
 * Phase 5 CI/CD explorer.
 *
 * Shows one workflow at a time: its triggers, a job dependency graph, and the
 * selected job's steps. Workflow content is untrusted data — every value is
 * rendered as React text, and the graph is built through the shared escaping
 * utility. Nothing here executes a `run` command or an action.
 */
export function WorkflowExplorer({ state }: WorkflowExplorerProps) {
  const { status, analysis, error } = state;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [diagram, setDiagram] = useState<DiagramState>({ kind: "rendering" });

  const workflows = useMemo(() => analysis?.workflows ?? [], [analysis]);

  // Default to the first workflow, and recover if the selection no longer
  // exists after a different repository was analyzed.
  const current: Workflow | null = useMemo(() => {
    if (workflows.length === 0) return null;
    return workflows.find((w) => w.path === selectedPath) ?? workflows[0];
  }, [workflows, selectedPath]);

  const graph = useMemo(
    () => (current === null ? null : generateWorkflowDiagram(current)),
    [current]
  );

  useEffect(() => {
    setSelectedJobId(null);
  }, [current?.path]);

  useEffect(() => {
    if (graph === null || graph.definition === null) return;

    let cancelled = false;
    setDiagram({ kind: "rendering" });

    renderMermaid(nextDiagramId("workflow-diagram"), graph.definition)
      .then((svg) => {
        if (!cancelled) setDiagram({ kind: "success", svg });
      })
      .catch((caught: unknown) => {
        // The user gets a short message; the real error goes to the console.
        // A Mermaid failure must never unmount the application.
        console.error("Mermaid failed to render the workflow diagram:", caught);
        if (!cancelled) setDiagram({ kind: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [graph]);

  /** Mermaid ids look like `flowchart-job_2-7`; recover the generated id. */
  const handleGraphClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (graph === null) return;
      const target = event.target as Element | null;
      const nodeEl = target?.closest?.("[id]") as Element | null;
      if (nodeEl === null || nodeEl === undefined) return;

      const match = /(?:^|-)(job_\d+)(?:-\d+)?$/.exec(nodeEl.id);
      const generatedId = match?.[1];
      if (generatedId === undefined) return;

      const jobId = graph.jobIdByNodeId.get(generatedId);
      if (jobId !== undefined) setSelectedJobId(jobId);
    },
    [graph]
  );

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Reading workflow files…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to analyze workflows</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (analysis === null) return null;

  if (workflows.length === 0) {
    return (
      <div className="empty-state" data-testid="workflows-empty">
        <span className="empty-state__icon" aria-hidden="true">
          ⚙
        </span>
        <p className="empty-state__text">
          This repository has no GitHub Actions workflows in
          <code> .github/workflows</code>.
        </p>
      </div>
    );
  }

  const selectedJob: WorkflowJob | null =
    current === null || selectedJobId === null
      ? null
      : (current.jobs.find((j) => j.id === selectedJobId) ?? null);

  return (
    <div className="wf" data-testid="workflow-explorer">
      {analysis.stats.truncated && (
        <div className="alert alert-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Partial analysis</strong>
            <span className="alert-body">
              An analysis limit was reached, so some workflows, jobs or steps
              are not shown.
            </span>
          </div>
        </div>
      )}

      <div className="wf-toolbar">
        <label className="toggle" htmlFor="workflow-select">
          Workflow
          <select
            id="workflow-select"
            className="select"
            value={current?.path ?? ""}
            onChange={(e) => setSelectedPath(e.target.value)}
          >
            {workflows.map((workflow) => (
              <option key={workflow.path} value={workflow.path}>
                {workflow.name}
                {workflow.parseError !== undefined ? " (unreadable)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="wf-toolbar__count">
          {workflows.length === 1 ? "1 workflow" : `${workflows.length} workflows`}
          {analysis.stats.workflowsFailed > 0
            ? ` · ${analysis.stats.workflowsFailed} unreadable`
            : ""}
        </span>
      </div>

      {current !== null && (
        <>
          <div className="wf-head">
            <h4 className="wf-head__name">{current.name}</h4>
            <code className="wf-head__path">{current.path}</code>
          </div>

          {current.parseError !== undefined ? (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">⚠</span>
              <div>
                <strong className="alert-title">
                  This workflow could not be parsed
                </strong>
                <span className="alert-body">{current.parseError}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="wf-triggers" data-testid="workflow-triggers">
                <span className="wf-triggers__label">Triggers</span>
                {current.triggers.length === 0 ? (
                  <span className="wf-triggers__none">none declared</span>
                ) : (
                  <ul className="wf-triggers__list">
                    {current.triggers.map((trigger) => {
                      const detail = describeTrigger(trigger);
                      return (
                        <li key={trigger.event} className="wf-trigger">
                          <span className="wf-trigger__event">{trigger.event}</span>
                          {detail !== "" && (
                            <span className="wf-trigger__detail">{detail}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {current.jobsTruncated && (
                <div className="alert alert-warning" role="status">
                  <span aria-hidden="true">⚠</span>
                  <div>
                    <strong className="alert-title">
                      Showing {current.jobs.length} of {current.jobCount} jobs
                    </strong>
                    <span className="alert-body">
                      A job limit was reached for this workflow.
                    </span>
                  </div>
                </div>
              )}

              {graph !== null && graph.exceededMaxNodes ? (
                <div className="diagram-placeholder">
                  <span className="diagram-placeholder__icon" aria-hidden="true">
                    ⚙
                  </span>
                  <p className="diagram-placeholder__text">
                    This workflow has {graph.nodeCount} jobs, more than the{" "}
                    {MAX_WORKFLOW_GRAPH_NODES} that can be drawn at once. Select
                    a job below to inspect it.
                  </p>
                </div>
              ) : graph === null || graph.definition === null ? (
                <div className="diagram-placeholder">
                  <p className="diagram-placeholder__text">
                    This workflow declares no jobs.
                  </p>
                </div>
              ) : diagram.kind === "error" ? (
                <div className="alert alert-error" role="alert">
                  <span aria-hidden="true">⚠</span>
                  <div>
                    <strong className="alert-title">
                      Unable to render this workflow diagram.
                    </strong>
                    <span className="alert-body">
                      The job list below still shows the workflow.
                    </span>
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
                  data-testid="workflow-graph"
                  onClick={handleGraphClick}
                  // mermaid.render() returns SVG it has already sanitised
                  // (securityLevel: "strict"); labels are escaped beforehand.
                  dangerouslySetInnerHTML={{ __html: diagram.svg }}
                />
              )}

              {current.jobs.length > 0 && (
                <>
                  <p className="diagram-hint">
                    Click a job in the diagram, or pick one below, to see its
                    steps.
                  </p>
                  <div className="wf-jobs" role="group" aria-label="Jobs">
                    {current.jobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        className={`wf-jobchip${job.id === selectedJobId ? " is-active" : ""}`}
                        aria-pressed={job.id === selectedJobId}
                        onClick={() => setSelectedJobId(job.id)}
                      >
                        {job.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedJob !== null && (
                <div className="wf-details card" data-testid="workflow-job-details">
                  <h4 className="wf-details__name">{selectedJob.name}</h4>
                  <dl className="wf-details__meta">
                    <div>
                      <dt>Job ID</dt>
                      <dd><code>{selectedJob.id}</code></dd>
                    </div>
                    {selectedJob.runsOn !== undefined && (
                      <div>
                        <dt>Runs on</dt>
                        <dd>{selectedJob.runsOn}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Needs</dt>
                      <dd>
                        {selectedJob.needs.length === 0
                          ? "nothing"
                          : selectedJob.needs.join(", ")}
                      </dd>
                    </div>
                    {selectedJob.environment !== undefined && (
                      <div>
                        <dt>Environment</dt>
                        <dd>{selectedJob.environment}</dd>
                      </div>
                    )}
                    {selectedJob.timeoutMinutes !== undefined && (
                      <div>
                        <dt>Timeout</dt>
                        <dd>{selectedJob.timeoutMinutes} min</dd>
                      </div>
                    )}
                    {selectedJob.continueOnError === true && (
                      <div>
                        <dt>Continue on error</dt>
                        <dd>yes</dd>
                      </div>
                    )}
                  </dl>

                  {selectedJob.if !== undefined && (
                    <p className="wf-details__row">
                      <strong className="wf-details__label">Condition</strong>
                      <code className="wf-code">{selectedJob.if}</code>
                    </p>
                  )}

                  {selectedJob.matrix !== undefined && (
                    <p className="wf-details__row" data-testid="workflow-matrix">
                      <strong className="wf-details__label">Matrix</strong>
                      <span>
                        {selectedJob.matrix.dimensions
                          .map((d) => `${d.key} = ${d.values.join(", ")}`)
                          .join(" · ")}
                        {selectedJob.matrix.hasInclude ? " · include" : ""}
                        {selectedJob.matrix.hasExclude ? " · exclude" : ""}
                      </span>
                    </p>
                  )}

                  {selectedJob.uses !== undefined ? (
                    <p className="wf-details__row" data-testid="workflow-reusable">
                      <strong className="wf-details__label">Reusable workflow</strong>
                      <code className="wf-code">{selectedJob.uses}</code>
                    </p>
                  ) : (
                    <>
                      <strong className="wf-details__label">
                        Steps ({selectedJob.stepCount})
                        {selectedJob.stepsTruncated
                          ? ` · showing first ${selectedJob.steps.length}`
                          : ""}
                      </strong>
                      {selectedJob.steps.length === 0 ? (
                        <p className="depdetails__empty">No steps declared.</p>
                      ) : (
                        <ol className="wf-steps">
                          {selectedJob.steps.map((step, index) => (
                            <li key={`${index}-${step.id ?? step.name ?? step.uses ?? "step"}`} className="wf-step">
                              <span className="wf-step__name">
                                {step.name ?? step.uses ?? "step"}
                              </span>
                              {step.uses !== undefined && (
                                <code className="wf-code">uses: {step.uses}</code>
                              )}
                              {step.run !== undefined && (
                                <pre className="wf-run">{step.run}</pre>
                              )}
                              {step.if !== undefined && (
                                <code className="wf-code">if: {step.if}</code>
                              )}
                              {(step.hasWith || step.hasEnv) && (
                                <span className="wf-step__flags">
                                  {step.hasWith ? "with" : ""}
                                  {step.hasWith && step.hasEnv ? " · " : ""}
                                  {step.hasEnv ? "env" : ""}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
