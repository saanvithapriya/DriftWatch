import { useEffect, useRef, useState } from "react";
import { analyzeCallGraph } from "../services/api";
import type { CallGraphAnalysis } from "../types/callGraph";

export type CallGraphStatus = "idle" | "loading" | "success" | "error";

export interface CallGraphAnalysisState {
  status: CallGraphStatus;
  analysis: CallGraphAnalysis | null;
  error: string | null;
}

export interface UseCallGraphAnalysisResult extends CallGraphAnalysisState {
  /** Explicitly selects an entry point; `undefined` asks for the backend's
   *  own deterministic default. */
  selectEntryPoint: (entryPointId: string | undefined) => void;
}

/**
 * Loads the call graph for a repository, re-running only the traversal when
 * the entry point changes.
 *
 * Mirrors the Phase 4/5 pattern (state lives above the view, keyed by
 * `analysisId` so switching tabs never re-requests) with one addition: a
 * change of *entry point* is also a new request, since the graph the backend
 * returns is the reachable subgraph from that specific entry point. This is
 * still cheap — the backend keeps a short-lived, per-caller cache of the
 * already-parsed function index (spec section 17), so switching functions
 * only re-runs a traversal over already-parsed source, not a new GitHub
 * download or a re-parse.
 */
export function useCallGraphAnalysis(
  repositoryUrl: string,
  enabled: boolean,
  analysisId: number
): UseCallGraphAnalysisResult {
  const [state, setState] = useState<CallGraphAnalysisState>({
    status: "idle",
    analysis: null,
    error: null,
  });
  const [entryPoint, setEntryPointState] = useState<string | undefined>(undefined);

  // A different repository, or a re-run of the same one, invalidates
  // whatever entry point was chosen for the previous analysis — reset it
  // synchronously during render (React's documented pattern for resetting
  // state when a dependency changes) so the very first fetch for the new
  // analysis already uses the fresh default, rather than briefly refetching
  // with a stale, possibly nonexistent, function id.
  const analysisKey = `${analysisId}::${repositoryUrl}`;
  const lastAnalysisKeyRef = useRef(analysisKey);
  if (lastAnalysisKeyRef.current !== analysisKey) {
    lastAnalysisKeyRef.current = analysisKey;
    if (entryPoint !== undefined) setEntryPointState(undefined);
  }

  const requestedFor = useRef<string | null>(null);
  const cacheKey = `${analysisKey}::${entryPoint ?? ""}`;

  useEffect(() => {
    if (repositoryUrl === "") return;
    if (!enabled || requestedFor.current === cacheKey) return;

    requestedFor.current = cacheKey;
    let cancelled = false;
    setState({ status: "loading", analysis: null, error: null });

    analyzeCallGraph(repositoryUrl, entryPoint)
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
          error: caught instanceof Error ? caught.message : "Failed to analyze call flow",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, repositoryUrl, enabled, entryPoint]);

  return {
    ...state,
    selectEntryPoint: setEntryPointState,
  };
}
