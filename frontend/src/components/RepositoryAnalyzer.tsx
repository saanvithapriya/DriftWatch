import { useState, type FormEvent } from "react";
import { analyzeGithubRepository } from "../services/api";
import type { RepositoryTree } from "../types/github";
import { isLikelyGithubRepositoryUrl } from "../utils/githubUrl";
import { buildFileTree } from "../utils/fileTree";
import { FileTree } from "./FileTree";
import { RepositoryDiagram } from "./RepositoryDiagram";
import { RepositorySummary } from "./RepositorySummary";
import type { TreeNode } from "../utils/mermaid";

type Status = "idle" | "loading" | "success" | "error";

export function RepositoryAnalyzer() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RepositoryTree | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // TODO: Replace buildFileTree(result.tree) with the real hierarchical
  // TreeNode[] once the tree-processing workstream provides it.
  const diagramTree: TreeNode[] | null =
    result === null ? null : (buildFileTree(result.tree) as TreeNode[]);

  const isLoading = status === "loading";
  const hasError = status === "error" && error !== null;

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

        {/* Error state */}
        {hasError && (
          <div className="alert alert-error analyzer-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <div>
              <strong className="alert-title">Unable to analyze repository</strong>
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

      {/* ── Success states ── */}
      {status === "success" && result !== null && (
        <>
          {/* Repository summary */}
          <RepositorySummary result={result} />

          {/* Mermaid visualization */}
          <section className="analyzer-section" aria-label="Repository structure diagram">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Structure</h3>
              <p className="analyzer-section__desc">
                Visual representation of the repository's file and folder structure.
              </p>
            </div>
            <div className="card diagram-card">
              <RepositoryDiagram tree={diagramTree} status={status} />
            </div>
          </section>

          {/* File tree */}
          <section className="analyzer-section" aria-label="Repository files">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Files</h3>
              <p className="analyzer-section__desc">
                Explore the file and folder structure.
              </p>
            </div>
            <div className="card filetree-card">
              <FileTree nodes={result.tree} />
            </div>
          </section>
        </>
      )}

      {/* ── Empty states (shown when idle or error) ── */}
      {(status === "idle" || status === "error") && (
        <>
          <section className="analyzer-section" aria-label="Repository structure diagram">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Structure</h3>
              <p className="analyzer-section__desc">
                Visual representation of the repository's file and folder structure.
              </p>
            </div>
            <div className="card diagram-card diagram-card--empty">
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true">⬡</span>
                <p className="empty-state__text">
                  Analyze a GitHub repository to see its structure here.
                </p>
              </div>
            </div>
          </section>

          <section className="analyzer-section" aria-label="Repository files">
            <div className="analyzer-section__header">
              <h3 className="analyzer-section__title">Repository Files</h3>
              <p className="analyzer-section__desc">
                Explore the file and folder structure.
              </p>
            </div>
            <div className="card filetree-card filetree-card--empty">
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true">📂</span>
                <p className="empty-state__text">
                  Your repository file tree will appear here after analysis.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
