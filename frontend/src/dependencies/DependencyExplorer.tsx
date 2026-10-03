import { useMemo, useState } from "react";
import { DependencyGraphView } from "./DependencyGraphView";
import type { DependencyAnalysisState } from "./useDependencyAnalysis";
import {
  MAX_DEPENDENCY_GRAPH_NODES,
  filterGraph,
  neighboursOf,
  topLevelDirectories,
} from "./graphModel";

interface DependencyExplorerProps {
  /**
   * Analysis state owned by the parent, so leaving and re-entering this tab
   * never re-requests the graph.
   */
  state: DependencyAnalysisState;
}

/**
 * Phase 4 dependency explorer.
 *
 * Fetches once per repository and keeps the result, so switching between the
 * Architecture and Dependencies tabs never re-requests anything.
 */
export function DependencyExplorer({ state }: DependencyExplorerProps) {
  const { status, analysis, error } = state;
  const [search, setSearch] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = analysis?.nodes ?? [];
  const edges = analysis?.edges ?? [];

  const filtered = useMemo(
    () => filterGraph(nodes, edges, { search, focusId }),
    [nodes, edges, search, focusId]
  );

  const directories = useMemo(() => topLevelDirectories(nodes), [nodes]);

  const details = useMemo(() => {
    if (selectedId === null) return null;
    const node = nodes.find((n) => n.id === selectedId);
    if (node === undefined) return null;
    return { node, ...neighboursOf(selectedId, edges) };
  }, [selectedId, nodes, edges]);

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">
          Fetching sources and parsing dependencies…
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to analyze dependencies</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (analysis === null) return null;

  const { stats } = analysis;
  const tooLarge = filtered.nodes.length > MAX_DEPENDENCY_GRAPH_NODES;
  const hasFilter = search.trim() !== "" || focusId !== null;

  return (
    <div className="depexplorer">
      {stats.truncated && (
        <div className="alert alert-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Partial analysis</strong>
            <span className="alert-body">
              {stats.filesSkipped.toLocaleString()} source files were not
              analyzed because an analysis limit was reached, so this graph is
              incomplete.
            </span>
          </div>
        </div>
      )}

      <dl className="depstats" data-testid="dependency-stats">
        <div className="depstats__item">
          <dt>Files analyzed</dt>
          <dd>{stats.filesAnalyzed.toLocaleString()}</dd>
        </div>
        <div className="depstats__item">
          <dt>Internal dependencies</dt>
          <dd>{stats.internalDependencies.toLocaleString()}</dd>
        </div>
        <div className="depstats__item">
          <dt>External packages</dt>
          <dd>{stats.externalPackages.toLocaleString()}</dd>
        </div>
        <div className="depstats__item">
          <dt>Unresolved imports</dt>
          <dd>{stats.unresolvedImports.toLocaleString()}</dd>
        </div>
        {stats.filesFailed > 0 && (
          <div className="depstats__item">
            <dt>Files not parsed</dt>
            <dd>{stats.filesFailed.toLocaleString()}</dd>
          </div>
        )}
      </dl>

      <div className="depcontrols">
        <label className="sr-only" htmlFor="dependency-search">
          Filter files by path
        </label>
        <input
          id="dependency-search"
          className="input depcontrols__search"
          type="search"
          placeholder="Filter by path, e.g. src/components"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {directories.length > 0 && (
          <>
            <label className="sr-only" htmlFor="dependency-directory">
              Filter by directory
            </label>
            <select
              id="dependency-directory"
              className="select"
              value={directories.includes(search) ? search : ""}
              onChange={(e) => setSearch(e.target.value)}
            >
              <option value="">All directories</option>
              {directories.map((directory) => (
                <option key={directory} value={directory}>
                  {directory}
                </option>
              ))}
            </select>
          </>
        )}
        {hasFilter && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSearch("");
              setFocusId(null);
            }}
          >
            Clear filter
          </button>
        )}
        <span className="depcontrols__count">
          {filtered.nodes.length.toLocaleString()} of{" "}
          {nodes.length.toLocaleString()} files
          {focusId !== null ? " · focused" : ""}
        </span>
      </div>

      {nodes.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            ⬡
          </span>
          <p className="empty-state__text">
            No JavaScript or TypeScript source files were found to analyze.
          </p>
        </div>
      ) : tooLarge ? (
        <div className="diagram-placeholder" data-testid="dependency-too-large">
          <span className="diagram-placeholder__icon" aria-hidden="true">
            ⬡
          </span>
          <p className="diagram-placeholder__text">
            This graph has {filtered.nodes.length.toLocaleString()} files, more
            than the {MAX_DEPENDENCY_GRAPH_NODES} that can be drawn at once.
            Filter by path or directory above, or select a file to focus on its
            immediate neighbourhood.
          </p>
        </div>
      ) : filtered.nodes.length === 0 ? (
        <div className="diagram-placeholder">
          <p className="diagram-placeholder__text">
            No files match this filter.
          </p>
        </div>
      ) : (
        <DependencyGraphView
          nodes={filtered.nodes}
          edges={filtered.edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {details !== null && (
        <div className="depdetails card" data-testid="dependency-details">
          <h4 className="depdetails__path">{details.node.path}</h4>
          <p className="depdetails__counts">
            {details.dependencies.length} dependencies ·{" "}
            {details.dependents.length} dependents
          </p>
          <div className="depdetails__lists">
            <div>
              <strong className="depdetails__heading">Imports</strong>
              {details.dependencies.length === 0 ? (
                <p className="depdetails__empty">None</p>
              ) : (
                <ul className="depdetails__list">
                  {details.dependencies.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <strong className="depdetails__heading">Imported by</strong>
              {details.dependents.length === 0 ? (
                <p className="depdetails__empty">None</p>
              ) : (
                <ul className="depdetails__list">
                  {details.dependents.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              setFocusId((current) =>
                current === details.node.id ? null : details.node.id
              )
            }
          >
            {focusId === details.node.id
              ? "Clear focus"
              : "Focus dependencies"}
          </button>
        </div>
      )}
    </div>
  );
}
