import type { OnDemandState } from "./useOnDemandResource";
import type { HistoryStats } from "../types/history";

interface ChangeHotspotsProps {
  state: OnDemandState<HistoryStats>;
  onSelectPath: (path: string) => void;
}

/**
 * Change Hotspots (spec section 9): observed historical change frequency
 * only — explicitly not a bug-proneness or code-quality signal, which is
 * stated in the UI itself, not just the README.
 */
export function ChangeHotspots({ state, onSelectPath }: ChangeHotspotsProps) {
  const { status, data, error } = state;

  if (status === "idle" || status === "loading") {
    return (
      <div className="diagram-placeholder">
        {status === "loading" && <span className="spinner spinner--large" aria-hidden="true" />}
        <p className="diagram-placeholder__text">
          {status === "loading"
            ? "Inspecting commits individually — this can take a moment…"
            : "Loading…"}
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to load change hotspots</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (data === null) return null;

  return (
    <div data-testid="change-hotspots">
      <p className="diagram-hint">
        Files changed most often in the currently loaded commits — observed frequency only, not
        a measure of code quality or bug-proneness. Click a file to see its own history.
      </p>
      {data.truncated && (
        <div className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Partial data</strong>
            <span className="alert-body">A per-commit file-list limit was reached for at least one commit.</span>
          </div>
        </div>
      )}
      {data.hotspots.length === 0 ? (
        <p className="depdetails__empty">No file changes found in this range.</p>
      ) : (
        <div className="hx-filelist">
          {data.hotspots.map((hotspot) => (
            <button
              key={hotspot.path}
              type="button"
              className="hx-hotspot"
              onClick={() => onSelectPath(hotspot.path)}
            >
              <span className="hx-hotspot__path">{hotspot.path}</span>
              <span className="hx-hotspot__count">
                {hotspot.commits} commit{hotspot.commits === 1 ? "" : "s"}
              </span>
              <span className="hx-stat hx-stat--add">+{hotspot.additions}</span>
              <span className="hx-stat hx-stat--del">−{hotspot.deletions}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
