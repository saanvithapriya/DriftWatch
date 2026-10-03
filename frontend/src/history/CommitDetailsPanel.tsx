import type { OnDemandState } from "./useOnDemandResource";
import type { ChangedFile, CommitDetail } from "../types/history";
import { changedFileStatusLabel, formatCommitDate } from "./historyModel";

interface CommitDetailsPanelProps {
  state: OnDemandState<CommitDetail>;
  onOpenFileHistory: (path: string) => void;
}

function FileRow({ file, onOpenFileHistory }: { file: ChangedFile; onOpenFileHistory: (path: string) => void }) {
  return (
    <div className="hx-filerow">
      <span className={`hx-badge hx-badge--${file.status}`}>{changedFileStatusLabel(file.status)}</span>
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
  );
}

/** Commit Details panel (spec section 4/18): full sha, message, author,
 *  date, and the changed-file list for one selected commit. */
export function CommitDetailsPanel({ state, onOpenFileHistory }: CommitDetailsPanelProps) {
  const { status, data, error } = state;

  if (status === "idle") {
    return (
      <div className="diagram-placeholder">
        <p className="diagram-placeholder__text">Select a commit to see its details.</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Loading commit…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to load this commit</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (data === null) return null;
  const { commit, stats, files, filesTruncated } = data;

  return (
    <div className="wf-details card" data-testid="commit-details">
      <h4 className="wf-details__name">{commit.message.split("\n")[0]}</h4>
      <dl className="wf-details__meta">
        <div>
          <dt>SHA</dt>
          <dd>
            <code>{commit.sha}</code>
          </dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{commit.author.login ?? (commit.author.name || "unknown")}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatCommitDate(commit.date)}</dd>
        </div>
        <div>
          <dt>Files changed</dt>
          <dd>{stats.filesChanged}</dd>
        </div>
        <div>
          <dt>Additions</dt>
          <dd className="hx-stat hx-stat--add">+{stats.additions}</dd>
        </div>
        <div>
          <dt>Deletions</dt>
          <dd className="hx-stat hx-stat--del">−{stats.deletions}</dd>
        </div>
      </dl>

      {filesTruncated && (
        <div className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Showing {files.length} of {stats.filesChanged} files</strong>
            <span className="alert-body">A file-list limit was reached for this commit.</span>
          </div>
        </div>
      )}

      {files.length === 0 ? (
        <p className="depdetails__empty">No file changes recorded.</p>
      ) : (
        <div className="hx-filelist">
          {files.map((file) => (
            <FileRow key={file.path} file={file} onOpenFileHistory={onOpenFileHistory} />
          ))}
        </div>
      )}
    </div>
  );
}
