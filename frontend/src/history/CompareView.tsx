import { useState } from "react";
import type { OnDemandState } from "./useOnDemandResource";
import type { CommitComparison } from "../types/history";
import { changedFileStatusLabel } from "./historyModel";

interface CompareViewProps {
  state: OnDemandState<CommitComparison>;
  onCompare: (base: string, head: string) => void;
  onOpenFileHistory: (path: string) => void;
  /** Pre-fills the head field when a commit is already selected elsewhere. */
  defaultHead?: string;
}

/** Compare Commits (spec section 5/19): two ref inputs, a Compare button,
 *  then the changed-file list between them. */
export function CompareView({ state, onCompare, onOpenFileHistory, defaultHead }: CompareViewProps) {
  const [base, setBase] = useState("");
  const [head, setHead] = useState(defaultHead ?? "");

  const canCompare = base.trim() !== "" && head.trim() !== "";

  return (
    <div data-testid="compare-view">
      <div className="hx-compare-row">
        <div className="hx-compare-field">
          <label htmlFor="compare-base">Base commit</label>
          <input
            id="compare-base"
            className="input"
            placeholder="sha or ref"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="hx-compare-field">
          <label htmlFor="compare-head">Head commit</label>
          <input
            id="compare-head"
            className="input"
            placeholder="sha or ref"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCompare}
          onClick={() => onCompare(base.trim(), head.trim())}
        >
          Compare
        </button>
      </div>

      {state.status === "loading" && (
        <div className="diagram-placeholder">
          <span className="spinner spinner--large" aria-hidden="true" />
          <p className="diagram-placeholder__text">Comparing…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Unable to compare these commits</strong>
            <span className="alert-body">{state.error}</span>
          </div>
        </div>
      )}

      {state.status === "success" && state.data !== null && (
        <>
          <dl className="wf-details__meta">
            <div>
              <dt>Files changed</dt>
              <dd>{state.data.stats.filesChanged}</dd>
            </div>
            <div>
              <dt>Additions</dt>
              <dd className="hx-stat hx-stat--add">+{state.data.stats.additions}</dd>
            </div>
            <div>
              <dt>Deletions</dt>
              <dd className="hx-stat hx-stat--del">−{state.data.stats.deletions}</dd>
            </div>
          </dl>

          {state.data.filesTruncated && (
            <div className="alert alert-warning" role="status">
              <span aria-hidden="true">⚠</span>
              <div>
                <strong className="alert-title">Showing {state.data.files.length} of {state.data.stats.filesChanged} files</strong>
                <span className="alert-body">A file-list limit was reached for this comparison.</span>
              </div>
            </div>
          )}

          {state.data.files.length === 0 ? (
            <p className="depdetails__empty">No file differences between these commits.</p>
          ) : (
            <div className="hx-filelist">
              {state.data.files.map((file) => (
                <div key={file.path} className="hx-filerow">
                  <span className={`hx-badge hx-badge--${file.status}`}>
                    {changedFileStatusLabel(file.status)}
                  </span>
                  <button
                    type="button"
                    className="hx-filerow__path"
                    onClick={() => onOpenFileHistory(file.path)}
                    title="View this file's history"
                  >
                    {file.previousPath !== null ? `${file.previousPath} → ${file.path}` : file.path}
                  </button>
                  <span className="hx-stat hx-stat--add">+{file.additions}</span>
                  <span className="hx-stat hx-stat--del">−{file.deletions}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
