import { useEffect, useRef, useState } from "react";
import { analyzeWorkflows } from "../services/api";
import type { WorkflowAnalysis } from "../types/workflows";

export type WorkflowStatus = "idle" | "loading" | "success" | "error";

export interface WorkflowAnalysisState {
  status: WorkflowStatus;
  analysis: WorkflowAnalysis | null;
  error: string | null;
}

/**
 * Loads the workflow analysis for a repository, at most once per analysis.
 *
 * Mirrors the Phase 4 dependency hook: the state lives above the CI/CD view so
 * switching tabs never re-requests, while a fresh analysis of the *same* URL
 * does invalidate the cache — which is why the key includes `analysisId`
 * rather than the URL alone.
 */
export function useWorkflowAnalysis(
  repositoryUrl: string,
  enabled: boolean,
  analysisId: number
): WorkflowAnalysisState {
  const [state, setState] = useState<WorkflowAnalysisState>({
    status: "idle",
    analysis: null,
    error: null,
  });

  const requestedFor = useRef<string | null>(null);
  const cacheKey = `${analysisId}::${repositoryUrl}`;

  useEffect(() => {
    if (repositoryUrl === "") return;

    if (requestedFor.current !== null && requestedFor.current !== cacheKey) {
      requestedFor.current = null;
      setState({ status: "idle", analysis: null, error: null });
    }

    if (!enabled || requestedFor.current === cacheKey) return;

    requestedFor.current = cacheKey;
    let cancelled = false;
    setState({ status: "loading", analysis: null, error: null });

    analyzeWorkflows(repositoryUrl)
      .then((analysis) => {
        if (!cancelled) setState({ status: "success", analysis, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Allow a retry after a failure rather than caching the error.
        requestedFor.current = null;
        setState({
          status: "error",
          analysis: null,
          error:
            caught instanceof Error
              ? caught.message
              : "Failed to analyze workflows",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, repositoryUrl, enabled]);

  return state;
}
