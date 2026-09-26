import { useMemo, useState, type FormEvent } from "react";
import { analyzeGithubRepository } from "../services/api";
import type { RepositoryTree } from "../types/github";
import { isLikelyGithubRepositoryUrl } from "../utils/githubUrl";
import { buildFileTree } from "../utils/fileTree";
import { FileTree } from "./FileTree";
import { RepositoryDiagram } from "./RepositoryDiagram";
import { RepositorySummary } from "./RepositorySummary";

type Status = "idle" | "loading" | "success" | "error";
type View = "tree" | "diagram";

export function RepositoryAnalyzer() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RepositoryTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase 1's file tree stays the default view; the diagram is opt-in, which
  // also means Mermaid does no work until the user asks for it.
  const [view, setView] = useState<View>("tree");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = url.trim();

    if (trimmed === "") {
      setStatus("error");
      setResult(null);
      setError("Please enter a GitHub repository URL.");
      return;
    }

    if (!isLikelyGithubRepositoryUrl(trimmed)) {
      setStatus("error");
      setResult(null);
      setError(
        "Enter a repository URL in the form https://github.com/owner/repository"
      );
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const data = await analyzeGithubRepository(trimmed);
      setResult(data);
      setStatus("success");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to fetch GitHub repository"
      );
      setStatus("error");
    }
  }

  // Memoized on `result`: this array is the `tree` prop of RepositoryDiagram,
  // whose render effect keys on prop identity. Rebuilding it on every render
  // would re-run the whole Mermaid render on each keystroke in the URL field.
  const hierarchy = useMemo(
    () => (result === null ? null : buildFileTree(result.tree)),
    [result]
  );

  const isLoading = status === "loading";
  const hasError = status === "error" && error !== null;
  const repositoryLabel =
    result === null
      ? ""
      : `${result.repository.owner}/${result.repository.name}`;

  return (
    <div className="analyzer-layout">
      {/* ── Analyzer card ── */}
      <section className="card analyzer-card" aria-label="Repository analyzer">
        <div className="card-header">
          <h2 className="card-title">Analyze GitHub Repository</h2>
          <p className="card-desc">
            Enter a public GitHub repository URL to analyze its structure.
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
              Public repositories only · No authentication required
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
      {status === "success" && result !== null && hierarchy !== null && (
        <>
          <RepositorySummary result={result} />

          <section className="analyzer-section" aria-label="Repository structure">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Structure</h3>
              <p className="analyzer-section__desc">
                Browse the files, or view the structure as a diagram.
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
                Diagram
              </button>
            </div>

            {view === "tree" ? (
              <div
                className="card filetree-card"
                id="panel-tree"
                role="tabpanel"
                aria-labelledby="tab-tree"
              >
                <FileTree nodes={result.tree} />
              </div>
            ) : (
              <div
                className="card diagram-card"
                id="panel-diagram"
                role="tabpanel"
                aria-labelledby="tab-diagram"
              >
                <RepositoryDiagram
                  // Remount per repository so diagram mode resets with it.
                  key={repositoryLabel}
                  tree={hierarchy}
                  repositoryLabel={repositoryLabel}
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
              Browse the files, or view the structure as a diagram.
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
