import { useMemo, useState, type FormEvent } from "react";
import { githubConnectUrl } from "../auth/authApi";
import { useAuth } from "../auth/AuthContext";
import { CallFlowExplorer } from "../callgraph/CallFlowExplorer";
import { useCallGraphAnalysis } from "../callgraph/useCallGraphAnalysis";
import { DependencyExplorer } from "../dependencies/DependencyExplorer";
import { useDependencyAnalysis } from "../dependencies/useDependencyAnalysis";
import { WorkflowExplorer } from "../workflows/WorkflowExplorer";
import { useWorkflowAnalysis } from "../workflows/useWorkflowAnalysis";
import { ApiError, analyzeGithubRepository } from "../services/api";
import type { RepositoryTree } from "../types/github";
import { isLikelyGithubRepositoryUrl } from "../utils/githubUrl";
import { ROOT_PATH, buildFileTree, createRepositoryRoot } from "../utils/fileTree";
import { FileTree } from "./FileTree";
import { RepositoryDiagram } from "./RepositoryDiagram";
import { RepositorySummary } from "./RepositorySummary";

type Status = "idle" | "loading" | "success" | "error";
type View = "tree" | "diagram" | "dependencies" | "workflows" | "callgraph";

export function RepositoryAnalyzer() {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RepositoryTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  // Phase 1's file tree stays the default view; the diagram is opt-in, which
  // also means Mermaid does no work until the user asks for it.
  const [view, setView] = useState<View>("tree");
  // Where the architecture view is currently pointing. The repository tree is
  // never mutated by navigation — only this path changes, and the visible
  // subtree is derived from it.
  const [currentPath, setCurrentPath] = useState<string>(ROOT_PATH);
  // The URL that produced the current result. The input stays editable, so the
  // dependency view must not read from it directly.
  const [analyzedUrl, setAnalyzedUrl] = useState("");
  // Bumped on every completed analysis so a re-run of the same URL refreshes
  // derived views instead of serving a cached result.
  const [analysisId, setAnalysisId] = useState(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = url.trim();

    if (trimmed === "") {
      setStatus("error");
      setResult(null);
      setErrorStatus(null);
      setError("Please enter a GitHub repository URL.");
      return;
    }

    if (!isLikelyGithubRepositoryUrl(trimmed)) {
      setStatus("error");
      setResult(null);
      setErrorStatus(null);
      setError(
        "Enter a repository URL in the form https://github.com/owner/repository"
      );
      return;
    }

    setStatus("loading");
    setError(null);
    setErrorStatus(null);
    setResult(null);

    try {
      const data = await analyzeGithubRepository(trimmed);
      setResult(data);
      setAnalyzedUrl(trimmed);
      setAnalysisId((id) => id + 1);
      // A new repository always starts at its own root.
      setCurrentPath(ROOT_PATH);
      setStatus("success");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to fetch GitHub repository"
      );
      setErrorStatus(caught instanceof ApiError ? caught.status : null);
      setStatus("error");
    }
  }

  const repositoryLabel =
    result === null
      ? ""
      : `${result.repository.owner}/${result.repository.name}`;

  // Built once per analysis: the hierarchy, its size metadata, and the
  // synthetic repository root that navigation starts from. Both views read
  // from this same structure rather than keeping their own copy.
  const root = useMemo(
    () =>
      result === null
        ? null
        : createRepositoryRoot(repositoryLabel, buildFileTree(result.tree)),
    [result, repositoryLabel]
  );

  // Lazy: nothing is requested until the Dependencies tab is first opened,
  // and the result survives switching away and back.
  const dependencyState = useDependencyAnalysis(
    analyzedUrl,
    view === "dependencies",
    analysisId
  );

  // Same pattern: lazy, cached per analysis, invalidated by a re-run.
  const workflowState = useWorkflowAnalysis(
    analyzedUrl,
    view === "workflows",
    analysisId
  );

  // Same pattern again, plus its own entry-point selection (Phase 6).
  const callGraphState = useCallGraphAnalysis(
    analyzedUrl,
    view === "callgraph",
    analysisId
  );

  const isLoading = status === "loading";
  const hasError = status === "error" && error !== null;
  // 404 is GitHub deliberately hiding a private repository's existence, so the
  // hint is phrased as a possibility and never confirms that the repo exists.
  const mayNeedAccess =
    hasError && errorStatus !== null && [401, 403, 404].includes(errorStatus);

  function openInDiagram(path: string): void {
    setCurrentPath(path);
    setView("diagram");
  }

  return (
    <div className="analyzer-layout">
      {/* ── Analyzer card ── */}
      <section className="card analyzer-card" aria-label="Repository analyzer">
        <div className="card-header">
          <h2 className="card-title">Analyze GitHub Repository</h2>
          <p className="card-desc">
            Enter a GitHub repository URL to analyze its structure.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="label" htmlFor="repository-url">
              Repository URL
            </label>
            <div className="analyzer-form-row">
              <input
                id="repository-url"
                type="url"
                className={`input analyzer-input${hasError ? " has-error" : ""}`}
                value={url}
                placeholder="https://github.com/owner/repository"
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="btn btn-primary analyzer-btn"
                disabled={isLoading}
              >
                {isLoading && <span className="spinner" aria-hidden="true" />}
                {isLoading ? "Analyzing…" : "Analyze Repository"}
              </button>
            </div>
            <p className="form-hint">
              {user === null
                ? "Public repositories · Connect GitHub to analyze private ones"
                : `Signed in as ${user.login} · public and accessible private repositories`}
            </p>
          </div>
        </form>

        {hasError && (
          <div className="alert alert-error analyzer-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <div>
              <strong className="alert-title">
                Unable to analyze repository
              </strong>
              <span className="alert-body">{error}</span>
              {mayNeedAccess && (
                <span className="alert-body">
                  {user === null ? (
                    <>
                      If it is private,{" "}
                      <a href={githubConnectUrl()}>connect GitHub</a> and make
                      sure your account has access.
                    </>
                  ) : (
                    <>
                      Signed in as {user.login}. Make sure this account has
                      access to the repository and that the DriftWatch GitHub
                      App is installed on it.
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Loading state ── */}
      {isLoading && (
        <div className="analyzer-loading" aria-live="polite" aria-busy="true">
          <span className="spinner spinner--large" aria-hidden="true" />
          <p className="analyzer-loading__text">Analyzing repository…</p>
        </div>
      )}

      {/* ── Success ── */}
      {status === "success" && result !== null && root !== null && (
        <>
          <RepositorySummary result={result} />

          <section className="analyzer-section" aria-label="Repository structure">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Structure</h3>
              <p className="analyzer-section__desc">
                Browse every file, explore the architecture, inspect
                source-file dependencies, or review CI/CD workflows.
              </p>
            </div>

            <div className="viewtabs" role="tablist" aria-label="Structure view">
              <button
                type="button"
                role="tab"
                id="tab-tree"
                aria-selected={view === "tree"}
                aria-controls="panel-tree"
                className={`viewtabs__tab${view === "tree" ? " is-active" : ""}`}
                onClick={() => setView("tree")}
              >
                File Tree
              </button>
              <button
                type="button"
                role="tab"
                id="tab-diagram"
                aria-selected={view === "diagram"}
                aria-controls="panel-diagram"
                className={`viewtabs__tab${view === "diagram" ? " is-active" : ""}`}
                onClick={() => setView("diagram")}
              >
                Architecture
              </button>
              <button
                type="button"
                role="tab"
                id="tab-dependencies"
                aria-selected={view === "dependencies"}
                aria-controls="panel-dependencies"
                className={`viewtabs__tab${view === "dependencies" ? " is-active" : ""}`}
                onClick={() => setView("dependencies")}
              >
                Dependencies
              </button>
              <button
                type="button"
                role="tab"
                id="tab-workflows"
                aria-selected={view === "workflows"}
                aria-controls="panel-workflows"
                className={`viewtabs__tab${view === "workflows" ? " is-active" : ""}`}
                onClick={() => setView("workflows")}
              >
                CI/CD
              </button>
              <button
                type="button"
                role="tab"
                id="tab-callgraph"
                aria-selected={view === "callgraph"}
                aria-controls="panel-callgraph"
                className={`viewtabs__tab${view === "callgraph" ? " is-active" : ""}`}
                onClick={() => setView("callgraph")}
              >
                Call Flow
              </button>
            </div>

            {view === "callgraph" ? (
              <div
                className="card diagram-card"
                id="panel-callgraph"
                role="tabpanel"
                aria-labelledby="tab-callgraph"
              >
                <CallFlowExplorer state={callGraphState} />
              </div>
            ) : view === "workflows" ? (
              <div
                className="card diagram-card"
                id="panel-workflows"
                role="tabpanel"
                aria-labelledby="tab-workflows"
              >
                <WorkflowExplorer state={workflowState} />
              </div>
            ) : view === "dependencies" ? (
              <div
                className="card diagram-card"
                id="panel-dependencies"
                role="tabpanel"
                aria-labelledby="tab-dependencies"
              >
                <DependencyExplorer state={dependencyState} />
              </div>
            ) : view === "tree" ? (
              <div
                className="card filetree-card"
                id="panel-tree"
                role="tabpanel"
                aria-labelledby="tab-tree"
              >
                <FileTree nodes={root.children} onOpenInDiagram={openInDiagram} />
              </div>
            ) : (
              <div
                className="card diagram-card"
                id="panel-diagram"
                role="tabpanel"
                aria-labelledby="tab-diagram"
              >
                <RepositoryDiagram
                  root={root}
                  currentPath={currentPath}
                  onNavigate={setCurrentPath}
                  truncated={result.truncated}
                />
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Empty state (idle or error) ── */}
      {(status === "idle" || status === "error") && (
        <section className="analyzer-section" aria-label="Repository structure">
          <div className="analyzer-section__header">
            <h3 className="analyzer-section__title">Repository Structure</h3>
            <p className="analyzer-section__desc">
              Browse every file, or explore the architecture by drilling into
              directories.
            </p>
          </div>
          <div className="card filetree-card filetree-card--empty">
            <div className="empty-state">
              <span className="empty-state__icon" aria-hidden="true">
                📂
              </span>
              <p className="empty-state__text">
                Analyze a GitHub repository to see its structure here.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
