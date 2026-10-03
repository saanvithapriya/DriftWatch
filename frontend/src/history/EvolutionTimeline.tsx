import type { CommitSummary, HistoryPagination } from "../types/history";
import { commitTitle, formatCommitDate } from "./historyModel";

interface EvolutionTimelineProps {
  commits: readonly CommitSummary[];
  pagination: HistoryPagination;
  selectedSha: string | null;
  onSelect: (sha: string) => void;
  onPageChange: (page: number) => void;
}

/**
 * The Evolution Timeline: newest-first commit list (spec section 7).
 *
 * Each row is a plain `<button>`, keyboard-accessible by default, rendering
 * every repository-controlled string (message, author name) as ordinary
 * React text — never through `dangerouslySetInnerHTML`.
 */
export function EvolutionTimeline({
  commits,
  pagination,
  selectedSha,
  onSelect,
  onPageChange,
}: EvolutionTimelineProps) {
  if (commits.length === 0) {
    return (
      <div className="empty-state" data-testid="history-empty">
        <span className="empty-state__icon" aria-hidden="true">
          🕘
        </span>
        <p className="empty-state__text">This repository has no commits on this page.</p>
      </div>
    );
  }

  return (
    <div className="hx-timeline" data-testid="evolution-timeline" role="list" aria-label="Commit history">
      {commits.map((commit) => (
        <button
          key={commit.sha}
          type="button"
          role="listitem"
          className={`hx-commit${commit.sha === selectedSha ? " is-selected" : ""}`}
          aria-pressed={commit.sha === selectedSha}
          onClick={() => onSelect(commit.sha)}
        >
          <code className="hx-commit__sha">{commit.shortSha}</code>
          <span className="hx-commit__main">
            <span className="hx-commit__message">{commitTitle(commit.message)}</span>
            <span className="hx-commit__meta">
              <span>{commit.author.login ?? (commit.author.name || "unknown")}</span>
              <span>·</span>
              <span>{formatCommitDate(commit.date)}</span>
            </span>
          </span>
        </button>
      ))}

      <div className="hx-toolbar" data-testid="history-pagination">
        <button
          type="button"
          className="btn-ghost"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          ← Newer
        </button>
        <span className="wf-toolbar__count">Page {pagination.page}</span>
        <button
          type="button"
          className="btn-ghost"
          disabled={!pagination.hasNextPage}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Older →
        </button>
      </div>
    </div>
  );
}
