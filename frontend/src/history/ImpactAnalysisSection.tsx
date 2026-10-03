import { useMemo, useState } from "react";
import type { OnDemandState } from "./useOnDemandResource";
import type { ImpactAnalysis, ImpactNode } from "../types/history";
import { ImpactGraphView } from "./ImpactGraphView";
import { impactRelationshipLabel } from "./historyModel";

interface ImpactAnalysisSectionProps {
  state: OnDemandState<ImpactAnalysis>;
  onAnalyze: (base: string, head: string, maxDepth: number) => void;
  defaultBase?: string;
  defaultHead?: string;
}

const MAX_GRAPH_NODES = 300;

/**
 * Impact Analysis (spec sections 10/11/20): base/head/depth inputs, then —
 * after the user clicks Analyze — the statically inferred impact graph with
 * search, a depth filter, and a node-details panel.
 *
 * Always shows the standing disclaimer regardless of what the API response's
 * own `warnings` happen to contain for this particular result, per spec
 * section 12.
 */
export function ImpactAnalysisSection({
  state,
  onAnalyze,
  defaultBase,
  defaultHead,
}: ImpactAnalysisSectionProps) {
  const [base, setBase] = useState(defaultBase ?? "");
  const [head, setHead] = useState(defaultHead ?? "");
  const [maxDepth, setMaxDepth] = useState(3);
  const [search, setSearch] = useState("");
  const [depthFilter, setDepthFilter] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canAnalyze = base.trim() !== "" && head.trim() !== "";
  const data = state.data;

  const filteredNodes = useMemo(() => {
    if (data === null) return [];
    const term = search.trim().toLowerCase();
    return data.nodes.filter((n) => {
      if (term !== "" && !n.path.toLowerCase().includes(term)) return false;
      if (depthFilter !== null && n.depth > depthFilter) return false;
      return true;
    });
  }, [data, search, depthFilter]);

  const filteredIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(
    () => (data === null ? [] : data.edges.filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target))),
    [data, filteredIds]
  );

  const selected: ImpactNode | null =
    selectedId === null ? null : filteredNodes.find((n) => n.id === selectedId) ?? null;

  const neighbours = useMemo(() => {
    if (data === null || selectedId === null) return null;
    const dependsOn = data.edges.filter((e) => e.source === selectedId).map((e) => e.target).sort();
    const dependedOnBy = data.edges.filter((e) => e.target === selectedId).map((e) => e.source).sort();
    return { dependsOn, dependedOnBy };
  }, [data, selectedId]);

  return (
    <div data-testid="impact-analysis">
      <div className="hx-compare-row">
        <div className="hx-compare-field">
          <label htmlFor="impact-base">Base commit</label>
          <input
            id="impact-base"
            className="input"
            placeholder="sha or ref"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="hx-compare-field">
          <label htmlFor="impact-head">Head commit</label>
          <input
            id="impact-head"
            className="input"
            placeholder="sha or ref"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <label className="toggle" htmlFor="impact-max-depth">
          Max depth
          <select
            id="impact-max-depth"
            className="select"
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canAnalyze}
          onClick={() => {
            setSelectedId(null);
            onAnalyze(base.trim(), head.trim(), maxDepth);
          }}
        >
          Analyze Impact
        </button>
      </div>

      <p className="diagram-hint">
        Impact analysis is based on statically resolved dependencies and may not capture dynamic
        runtime relationships.
      </p>

      {state.status === "loading" && (
        <div className="diagram-placeholder">
          <span className="spinner spinner--large" aria-hidden="true" />
          <p className="diagram-placeholder__text">Analyzing impact…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Unable to analyze impact</strong>
            <span className="alert-body">{state.error}</span>
          </div>
        </div>
      )}

      {state.status === "success" && data !== null && (
        <>
          {data.truncated && (
            <div className="alert alert-warning" role="alert">
              <span aria-hidden="true">⚠</span>
              <div>
                <strong className="alert-title">Impact graph exceeded configured limits.</strong>
                <span className="alert-body">
                  {data.truncationReason === "max_depth"
                    ? "The traversal stopped before reaching every transitively affected file."
                    : "Not every affected file is shown."}
                </span>
              </div>
            </div>
          )}
          {data.warnings
            .filter((w) => !w.includes("statically resolved dependencies")) // already shown above, always
            .map((w) => (
              <div className="alert alert-warning" role="status" key={w}>
                <span aria-hidden="true">⚠</span>
                <div>
                  <span className="alert-body">{w}</span>
                </div>
              </div>
            ))}

          <p className="wf-toolbar__count" data-testid="impact-stats">
            Changed: {data.stats.changedFiles} · Affected: {data.stats.affectedFiles} · Max depth:{" "}
            {data.stats.maxDepth}
            {data.functionImpact.available &&
              ` · Function-level analysis available (${data.functionImpact.changedFunctions.length} changed, ${data.functionImpact.affectedFunctions.length} affected functions)`}
          </p>

          <div className="hx-impact-controls">
            <input
              className="input"
              type="search"
              placeholder="Search by path"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search impact graph by path"
            />
            <label className="toggle" htmlFor="impact-depth-filter">
              Show up to depth
              <select
                id="impact-depth-filter"
                className="select"
                value={depthFilter ?? "all"}
                onChange={(e) => setDepthFilter(e.target.value === "all" ? null : Number(e.target.value))}
              >
                <option value="all">all</option>
                {Array.from({ length: data.stats.maxDepth + 1 }, (_, d) => d).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {data.nodes.length === 0 ? (
            <p className="depdetails__empty">No changed files in this comparison.</p>
          ) : filteredNodes.length > MAX_GRAPH_NODES ? (
            <div className="diagram-placeholder">
              <p className="diagram-placeholder__text">
                {filteredNodes.length} nodes match — narrow the search or depth filter to draw the graph.
              </p>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="diagram-placeholder">
              <p className="diagram-placeholder__text">No nodes match this filter.</p>
            </div>
          ) : (
            <ImpactGraphView
              nodes={filteredNodes}
              edges={filteredEdges}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}

          {selected !== null && neighbours !== null && (
            <div className="depdetails card" data-testid="impact-node-details">
              <h4 className="depdetails__path">{selected.path}</h4>
              <p className="depdetails__counts">
                {impactRelationshipLabel(selected.relationship)} · depth {selected.depth}
                {selected.changeStatus !== undefined && ` · ${selected.changeStatus}`}
              </p>
              <div className="depdetails__lists">
                <div>
                  <strong className="depdetails__heading">Depends on (changed/affected)</strong>
                  {neighbours.dependsOn.length === 0 ? (
                    <p className="depdetails__empty">None</p>
                  ) : (
                    <ul className="depdetails__list">
                      {neighbours.dependsOn.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <strong className="depdetails__heading">Depended on by</strong>
                  {neighbours.dependedOnBy.length === 0 ? (
                    <p className="depdetails__empty">None</p>
                  ) : (
                    <ul className="depdetails__list">
                      {neighbours.dependedOnBy.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
