import { useMemo, useState } from "react";
import type { SchemaAnalysisState } from "./useSchemaAnalysis";
import { SchemaGraphView } from "./SchemaGraphView";
import { availableProviders, filterSchemaGraph, providerLabel } from "./schemaModel";
import type { SchemaCardinality, SchemaGraphNode, SchemaSourceType } from "../types/schema";

interface SchemaExplorerProps {
  /** Analysis state owned by the parent, so leaving and re-entering this tab
   *  never re-requests the schema. */
  state: SchemaAnalysisState;
}

const MAX_SCHEMA_GRAPH_NODES = 200;

const CARDINALITIES: SchemaCardinality[] = ["1:1", "1:N", "N:1", "N:M", "unknown"];

/**
 * Phase 8 Schema explorer: statistics, provider/relationship filters,
 * search, the ER graph, and a node-details panel. All filtering is local —
 * changing a filter, the search box, or the selected node never issues
 * another GitHub request (spec sections 19/20/23), and the graph's own
 * layout is computed once per analysis, not on every filter change (section
 * 24) — see `SchemaGraphView` for how `allNodes`/`allEdges` vs
 * `visibleNodes`/`visibleEdges` keep those two concerns separate.
 */
export function SchemaExplorer({ state }: SchemaExplorerProps) {
  const { status, analysis, error } = state;
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<SchemaSourceType | "all">("all");
  const [relationship, setRelationship] = useState<SchemaCardinality | "all">("all");
  const [showFields, setShowFields] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = analysis?.nodes ?? [];
  const edges = analysis?.edges ?? [];

  const filtered = useMemo(
    () => filterSchemaGraph(nodes, edges, { search, provider, relationship }),
    [nodes, edges, search, provider, relationship]
  );

  const providers = useMemo(() => availableProviders(nodes), [nodes]);

  const selected: SchemaGraphNode | null = useMemo(() => {
    if (selectedId === null) return null;
    return nodes.find((n) => n.id === selectedId) ?? null;
  }, [selectedId, nodes]);

  const selectedRelationships = useMemo(() => {
    if (selectedId === null) return [];
    return edges.filter((e) => e.source === selectedId || e.target === selectedId);
  }, [edges, selectedId]);

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Analyzing database schema…</p>
        <p className="diagram-placeholder__hint">
          Detecting schema sources, parsing models, and building relationships.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to analyze the schema</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (analysis === null) return null;

  const { stats } = analysis;
  const hasFilter = search.trim() !== "" || provider !== "all" || relationship !== "all";
  const searchActive = search.trim() !== "";
  const tooLarge = filtered.nodes.length > MAX_SCHEMA_GRAPH_NODES;
  const providerEntries = Object.entries(stats.byProvider).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="sch" data-testid="schema-explorer">
      <p className="diagram-hint">
        Schema analysis is statically inferred from repository source files. DriftWatch does not
        connect to or execute against a live database.
      </p>

      {analysis.truncated && (
        <div className="alert alert-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Partial schema</strong>
            <span className="alert-body">
              {analysis.warnings.length > 0
                ? analysis.warnings[0]
                : "An analysis limit was reached, so this schema is incomplete."}
            </span>
          </div>
        </div>
      )}

      {nodes.length === 0 ? (
        <div className="empty-state" data-testid="schema-empty">
          <span className="empty-state__icon" aria-hidden="true">
            🗄
          </span>
          <strong className="empty-state__title">No database schema found</strong>
          <p className="empty-state__text">
            {analysis.warnings[0] ??
              "No Prisma, SQL, or Mongoose schema definitions were detected in this repository."}
          </p>
        </div>
      ) : (
        <>
          <div className="sch-summary">
            <dl className="sch-stats" data-testid="schema-stats">
              <div>
                <dt>Models/Tables</dt>
                <dd>
                  <strong>{stats.models.toLocaleString()}</strong>
                </dd>
              </div>
              <div>
                <dt>Fields</dt>
                <dd>
                  <strong>{stats.fields.toLocaleString()}</strong>
                </dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>
                  <strong>{stats.relationships.toLocaleString()}</strong>
                </dd>
              </div>
              <div>
                <dt>Primary keys</dt>
                <dd>
                  <strong>{stats.primaryKeys.toLocaleString()}</strong>
                </dd>
              </div>
              <div>
                <dt>Foreign keys</dt>
                <dd>
                  <strong>{stats.foreignKeys.toLocaleString()}</strong>
                </dd>
              </div>
              <div>
                <dt>Indexes</dt>
                <dd>
                  <strong>{stats.indexes.toLocaleString()}</strong>
                </dd>
              </div>
            </dl>

            <div className="sch-provider-pills" data-testid="schema-provider-breakdown">
              {providerEntries.map(([name, count]) => (
                <span key={name} className={`sch-provider-pill sch-provider-pill--${name}`}>
                  {providerLabel(name as SchemaSourceType)} <strong>{count}</strong>
                </span>
              ))}
            </div>
          </div>

          <div className="sch-toolbar">
            <label className="sr-only" htmlFor="schema-search">
              Search models and fields
            </label>
            <input
              id="schema-search"
              className="input sch-toolbar__search"
              type="search"
              placeholder="Search models or fields, e.g. user"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <label className="toggle" htmlFor="schema-provider-filter">
              Provider
              <select
                id="schema-provider-filter"
                className="select"
                value={provider}
                onChange={(e) => setProvider(e.target.value as SchemaSourceType | "all")}
              >
                <option value="all">All</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {providerLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            <label className="toggle" htmlFor="schema-relationship-filter">
              Relationship
              <select
                id="schema-relationship-filter"
                className="select"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value as SchemaCardinality | "all")}
              >
                <option value="all">All</option>
                {CARDINALITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="toggle" htmlFor="schema-show-fields">
              <input
                id="schema-show-fields"
                type="checkbox"
                checked={showFields}
                onChange={(e) => setShowFields(e.target.checked)}
              />
              Show fields
            </label>

            {hasFilter && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSearch("");
                  setProvider("all");
                  setRelationship("all");
                }}
              >
                Clear filters
              </button>
            )}

            <span className="wf-toolbar__count">
              {filtered.nodes.length.toLocaleString()} of {nodes.length.toLocaleString()} models
            </span>
          </div>

          {tooLarge ? (
            <div className="diagram-placeholder" data-testid="schema-too-large">
              <span className="diagram-placeholder__icon" aria-hidden="true">
                🗄
              </span>
              <p className="diagram-placeholder__text">
                This graph has {filtered.nodes.length.toLocaleString()} models, more than the{" "}
                {MAX_SCHEMA_GRAPH_NODES} that can be drawn at once. Search or filter by provider
                above to narrow it down.
              </p>
            </div>
          ) : filtered.nodes.length === 0 ? (
            <div className="diagram-placeholder">
              <p className="diagram-placeholder__text">No models match this filter.</p>
            </div>
          ) : (
            <div className="sch-layout">
              <SchemaGraphView
                allNodes={nodes}
                allEdges={edges}
                visibleNodes={filtered.nodes}
                visibleEdges={filtered.edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showFields={showFields}
                searchActive={searchActive}
              />

              {selected !== null && (
                <div className="sch-details-panel card" data-testid="schema-node-details">
                  <div className="sch-details-panel__header">
                    <h4 className="depdetails__path">{selected.model.name}</h4>
                    <button
                      type="button"
                      className="btn-ghost sch-details-panel__close"
                      onClick={() => setSelectedId(null)}
                      aria-label="Close details panel"
                    >
                      ×
                    </button>
                  </div>
                  <p className="depdetails__counts">
                    {providerLabel(selected.model.sourceType)} ·{" "}
                    <code>{selected.model.sourcePath}</code>
                  </p>

                  <strong className="depdetails__heading">Fields</strong>
                  <div className="sch-table" role="table">
                    <table className="sch-table">
                      <thead>
                        <tr>
                          <th scope="col">Field</th>
                          <th scope="col">Type</th>
                          <th scope="col">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.model.fields.map((field) => (
                          <tr key={field.id}>
                            <td>{field.name}</td>
                            <td>{field.type}</td>
                            <td>
                              {[
                                field.primaryKey ? "PK" : null,
                                field.references !== undefined ? "FK" : null,
                                field.unique ? "UQ" : null,
                                field.required ? "REQ" : null,
                              ]
                                .filter((v): v is string => v !== null)
                                .join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <strong className="depdetails__heading">Relationships</strong>
                  {selectedRelationships.length === 0 ? (
                    <p className="depdetails__empty">None</p>
                  ) : (
                    <ul className="depdetails__list">
                      {selectedRelationships.map((edge) => {
                        const outgoing = edge.source === selectedId;
                        const otherName = outgoing
                          ? edge.relationship.targetModel
                          : edge.relationship.sourceModel;
                        return (
                          <li key={edge.id}>
                            {outgoing ? "→" : "←"} {otherName} ({edge.relationship.cardinality})
                            {edge.relationship.relationName !== undefined &&
                              ` "${edge.relationship.relationName}"`}
                            {edge.relationship.inferred ? " · inferred" : " · explicit"}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {selected.model.indexes.length > 0 && (
                    <>
                      <strong className="depdetails__heading">Indexes</strong>
                      <ul className="depdetails__list">
                        {selected.model.indexes.map((index, i) => (
                          <li key={`${index.fields.join(",")}-${i}`}>
                            {index.name !== undefined ? `${index.name}: ` : ""}
                            {index.fields.join(", ")}
                            {index.unique ? " (unique)" : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
