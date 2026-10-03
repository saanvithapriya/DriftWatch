import { useState } from "react";
import { ChangeHotspots } from "./ChangeHotspots";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import { CompareView } from "./CompareView";
import { Contributors } from "./Contributors";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { FileHistoryPanel } from "./FileHistoryPanel";
import { ImpactAnalysisSection } from "./ImpactAnalysisSection";
import { useCommitDetail } from "./useCommitDetail";
import type { UseCommitHistoryResult } from "./useCommitHistory";
import { useCompareCommits } from "./useCompareCommits";
import { useFileHistory } from "./useFileHistory";
import { useHistoryStats } from "./useHistoryStats";
import { useImpactAnalysis } from "./useImpactAnalysis";

interface HistoryExplorerProps {
  repositoryUrl: string;
  analysisId: number;
  /** Owned by the parent, so revisiting this tab never re-requests the timeline. */
  historyState: UseCommitHistoryResult;
}

/**
 * Phase 7 History tab: Evolution Timeline, Commit Details, Change Hotspots,
 * Contributors, Compare Commits and Impact Analysis — the last four behind
 * progressive disclosure (`<details>`), since only the timeline and whatever
 * commit is selected need to be visible by default (spec section 17: "Do not
 * overwhelm the initial screen").
 */
export function HistoryExplorer({ repositoryUrl, analysisId, historyState }: HistoryExplorerProps) {
  const { status, history, error, query, setQuery } = historyState;

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  const commitDetail = useCommitDetail(repositoryUrl, analysisId);
  const fileHistory = useFileHistory(repositoryUrl, analysisId);
  const historyStats = useHistoryStats(repositoryUrl, analysisId);
  const compare = useCompareCommits(repositoryUrl, analysisId);
  const impact = useImpactAnalysis(repositoryUrl, analysisId);

  function selectCommit(sha: string): void {
    setSelectedSha(sha);
    setFilePath(null);
    commitDetail.select(sha);
  }

  function openFileHistory(path: string): void {
    setFilePath(path);
    fileHistory.load(path);
  }

  if (status === "loading") {
    return (
      <div className="diagram-placeholder">
        <span className="spinner spinner--large" aria-hidden="true" />
        <p className="diagram-placeholder__text">Loading commit history…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="alert alert-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <strong className="alert-title">Unable to load commit history</strong>
          <span className="alert-body">{error}</span>
        </div>
      </div>
    );
  }

  if (history === null) return null;

  return (
    <div className="hx" data-testid="history-explorer">
      <div className="hx-toolbar">
        <span className="wf-toolbar__count">
          {history.repository.owner}/{history.repository.name} · default branch{" "}
          <code>{history.repository.defaultBranch}</code>
        </span>
        <label className="toggle" htmlFor="history-per-page">
          Per page
          <select
            id="history-per-page"
            className="select"
            value={query.perPage ?? 30}
            onChange={(e) => setQuery({ ...query, page: 1, perPage: Number(e.target.value) })}
          >
            {[10, 30, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-label="Evolution timeline">
        <EvolutionTimeline
          commits={history.commits}
          pagination={history.pagination}
          selectedSha={selectedSha}
          onSelect={selectCommit}
          onPageChange={(page) => setQuery({ ...query, page })}
        />
      </section>

      {selectedSha !== null && (
        <section aria-label="Commit details">
          <CommitDetailsPanel state={commitDetail} onOpenFileHistory={openFileHistory} />
        </section>
      )}

      <FileHistoryPanel path={filePath} state={fileHistory} onClose={() => setFilePath(null)} />

      <details
        className="hx-section"
        onToggle={(e) => {
          if (e.currentTarget.open) historyStats.load(query);
        }}
      >
        <summary>Change Hotspots</summary>
        <div className="hx-section__body">
          <ChangeHotspots state={historyStats} onSelectPath={openFileHistory} />
        </div>
      </details>

      <details
        className="hx-section"
        onToggle={(e) => {
          if (e.currentTarget.open) historyStats.load(query);
        }}
      >
        <summary>Contributors</summary>
        <div className="hx-section__body">
          <Contributors state={historyStats} />
        </div>
      </details>

      <details className="hx-section">
        <summary>Compare Commits</summary>
        <div className="hx-section__body">
          <CompareView
            state={compare}
            onCompare={compare.compare}
            onOpenFileHistory={openFileHistory}
            defaultHead={selectedSha ?? undefined}
          />
        </div>
      </details>

      <details className="hx-section">
        <summary>Impact Analysis</summary>
        <div className="hx-section__body">
          <ImpactAnalysisSection
            state={impact}
            onAnalyze={impact.analyze}
            defaultHead={selectedSha ?? undefined}
          />
        </div>
      </details>
    </div>
  );
}
