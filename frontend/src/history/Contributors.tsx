import type { OnDemandState } from "./useOnDemandResource";
import type { HistoryStats } from "../types/history";

interface ContributorsProps {
  state: OnDemandState<HistoryStats>;
}

/**
 * Contributor activity (spec section 8): a plain, descriptive table —
 * commits, files changed, additions, deletions per author. Deliberately no
 * ranking, score, or "best contributor" — repository history only.
 */
export function Contributors({ state }: ContributorsProps) {
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
          <strong className="alert-title">Unable to load contributor activity</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (data === null) return null;

  if (data.contributors.length === 0) {
    return <p className="depdetails__empty">No commits found in this range.</p>;
  }

  return (
    <div className="hx-table-wrapper" data-testid="contributors">
      <table className="hx-table">
        <thead>
          <tr>
            <th scope="col">Author</th>
            <th scope="col">Commits</th>
            <th scope="col">Files changed</th>
            <th scope="col">Additions</th>
            <th scope="col">Deletions</th>
          </tr>
        </thead>
        <tbody>
          {data.contributors.map((c) => (
            <tr key={c.login ?? c.name}>
              <td>{c.name}</td>
              <td>{c.commits}</td>
              <td>{c.filesChanged}</td>
              <td className="hx-stat hx-stat--add">+{c.additions}</td>
              <td className="hx-stat hx-stat--del">−{c.deletions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
