import type { OnDemandState } from "./useOnDemandResource";
import type { FileHistory } from "../types/history";
import { formatCommitDate } from "./historyModel";

interface FileHistoryPanelProps {
  path: string | null;
  state: OnDemandState<FileHistory>;
  onClose: () => void;
}

/** Shown when a file is selected from Commit Details, Compare, or a hotspot
 *  (spec: "Clicking a hotspot should open its file history"). */
export function FileHistoryPanel({ path, state, onClose }: FileHistoryPanelProps) {
  if (path === null) return null;

  const { status, data, error } = state;

  return (
    <div className="wf-details card" data-testid="file-history-panel">
      <div className="wf-head">
        <h4 className="wf-head__name">File history</h4>
        <code className="wf-head__path">{path}</code>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {status === "loading" && (
        <div className="diagram-placeholder">
          <span className="spinner spinner--large" aria-hidden="true" />
          <p className="diagram-placeholder__text">Loading file history…</p>
        </div>
      )}

      {status === "error" && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Unable to load file history</strong>
            <span className="alert-body">{error}</span>
          </div>
        </div>
      )}

      {status === "success" && data !== null && (
        <>
          <dl className="wf-details__meta">
            <div>
              <dt>Total commits</dt>
              <dd>{data.stats.totalCommits}</dd>
            </div>
            <div>
              <dt>Active authors</dt>
              <dd>{data.stats.activeAuthors}</dd>
            </div>
            <div>
              <dt>Average changes per commit</dt>
              <dd>
                {data.stats.averageChangesPerCommit === null
                  ? "not available"
                  : data.stats.averageChangesPerCommit}
              </dd>
            </div>
            <div>
              <dt>Recent change rate</dt>
              <dd>{Math.round(data.stats.recentChangeRate * 100)}% in the last 90 days</dd>
            </div>
          </dl>

          {data.entries.length === 0 ? (
            <p className="depdetails__empty">No commits found for this file.</p>
          ) : (
            <ol className="wf-steps" data-testid="file-history-entries">
              {data.entries.map((entry) => (
                <li key={entry.sha} className="wf-step">
                  <span className="wf-step__name">
                    <code>{entry.shortSha}</code> {entry.message.split("\n")[0]}
                  </span>
                  <span className="wf-step__flags">
                    {entry.author.login ?? (entry.author.name || "unknown")} ·{" "}
                    {formatCommitDate(entry.date)}
                    {entry.additions !== undefined && entry.deletions !== undefined && (
                      <>
                        {" · "}
                        <span className="hx-stat hx-stat--add">+{entry.additions}</span>{" "}
                        <span className="hx-stat hx-stat--del">−{entry.deletions}</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
