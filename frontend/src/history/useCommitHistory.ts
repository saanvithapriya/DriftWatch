import { useEffect, useRef, useState } from "react";
import { fetchCommitHistory, type HistoryQueryParams } from "../services/api";
import type { RepositoryHistory } from "../types/history";

export type CommitHistoryStatus = "idle" | "loading" | "success" | "error";

export interface CommitHistoryState {
  status: CommitHistoryStatus;
  history: RepositoryHistory | null;
  error: string | null;
}

export interface UseCommitHistoryResult extends CommitHistoryState {
  /** Replaces the current page/filter set, triggering a new fetch. */
  setQuery: (query: HistoryQueryParams) => void;
  query: HistoryQueryParams;
}

/**
 * Loads commit history for a repository — the Evolution Timeline's primary
 * content, so (like Dependencies/CI/CD/Call Flow) it loads automatically
 * when the History tab is first opened, at most once per distinct page/
 * filter combination. Mirrors the Phase 4/5/6 analysis-hook pattern exactly:
 * state lives above the view, keyed by `analysisId` so switching tabs away
 * and back never re-requests, while a fresh repository analysis does.
 */
export function useCommitHistory(
  repositoryUrl: string,
  enabled: boolean,
  analysisId: number
): UseCommitHistoryResult {
  const [query, setQuery] = useState<HistoryQueryParams>({ page: 1, perPage: 30 });
  const [state, setState] = useState<CommitHistoryState>({
    status: "idle",
    history: null,
    error: null,
  });

  const analysisKey = `${analysisId}::${repositoryUrl}`;
  const lastAnalysisKeyRef = useRef(analysisKey);
  if (lastAnalysisKeyRef.current !== analysisKey) {
    lastAnalysisKeyRef.current = analysisKey;
    // A different repository, or a re-run of the same one: the previously
    // selected page/filters no longer apply to it.
    if (query.page !== 1 || query.perPage !== 30) setQuery({ page: 1, perPage: 30 });
  }

  const requestedFor = useRef<string | null>(null);
  const cacheKey = `${analysisKey}::${JSON.stringify(query)}`;

  useEffect(() => {
    if (repositoryUrl === "") return;
    if (!enabled || requestedFor.current === cacheKey) return;

    requestedFor.current = cacheKey;
    let cancelled = false;
    setState({ status: "loading", history: null, error: null });

    fetchCommitHistory(repositoryUrl, query)
      .then((history) => {
        if (!cancelled) setState({ status: "success", history, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        requestedFor.current = null;
        setState({
          status: "error",
          history: null,
          error: caught instanceof Error ? caught.message : "Failed to load commit history",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, repositoryUrl, enabled, query]);

  return { ...state, query, setQuery };
}
