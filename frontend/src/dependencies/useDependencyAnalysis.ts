import { useEffect, useRef, useState } from "react";
import { analyzeDependencies } from "../services/api";
import type { DependencyAnalysis } from "../types/dependencies";

export type DependencyStatus = "idle" | "loading" | "success" | "error";

export interface DependencyAnalysisState {
  status: DependencyStatus;
  analysis: DependencyAnalysis | null;
  error: string | null;
}

/**
 * Loads the dependency analysis for a repository, at most once.
 *
 * The state lives above the dependency view so that switching between the
 * Architecture and Dependencies tabs unmounts the graph without discarding
 * the result — re-opening the tab must not re-request anything. Analysis is
 * also lazy: nothing is fetched until the tab is first opened.
 */
export function useDependencyAnalysis(
  repositoryUrl: string,
  enabled: boolean,
  /**
   * Increments on every completed repository analysis. Without it, re-running
   * an analysis of the *same* URL would keep serving the cached graph, so a
   * repository whose contents changed (or one re-analyzed after signing in)
   * would show stale dependencies forever.
   */
  analysisId: number
): DependencyAnalysisState {
  const [state, setState] = useState<DependencyAnalysisState>({
    status: "idle",
    analysis: null,
    error: null,
  });

  // Identifies the analysis whose graph has been requested, so revisiting the
  // tab does not start another request but a fresh analysis does.
  const requestedFor = useRef<string | null>(null);
  const cacheKey = `${analysisId}::${repositoryUrl}`;

  useEffect(() => {
    if (repositoryUrl === "") return;

    // A different repository, or a re-run, invalidates whatever was loaded.
    if (requestedFor.current !== null && requestedFor.current !== cacheKey) {
      requestedFor.current = null;
      setState({ status: "idle", analysis: null, error: null });
    }

    if (!enabled || requestedFor.current === cacheKey) return;

    requestedFor.current = cacheKey;
    let cancelled = false;
    setState({ status: "loading", analysis: null, error: null });

    analyzeDependencies(repositoryUrl)
      .then((analysis) => {
        if (!cancelled) setState({ status: "success", analysis, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Allow a retry after a failure rather than caching the error forever.
        requestedFor.current = null;
        setState({
          status: "error",
          analysis: null,
          error:
            caught instanceof Error
              ? caught.message
              : "Failed to analyze dependencies",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, repositoryUrl, enabled]);

  return state;
}
