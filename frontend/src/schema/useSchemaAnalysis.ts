import { useEffect, useRef, useState } from "react";
import { analyzeSchema } from "../services/api";
import type { SchemaAnalysis } from "../types/schema";

export type SchemaAnalysisStatus = "idle" | "loading" | "success" | "error";

export interface SchemaAnalysisState {
  status: SchemaAnalysisStatus;
  analysis: SchemaAnalysis | null;
  error: string | null;
}

/**
 * Loads the database schema analysis for a repository, at most once per
 * analysis. Mirrors the Phase 4/5/6 pattern exactly: state lives above the
 * view, keyed by `analysisId`, so switching tabs away from and back to
 * Schema never re-requests, while a fresh repository analysis does.
 */
export function useSchemaAnalysis(
  repositoryUrl: string,
  enabled: boolean,
  analysisId: number
): SchemaAnalysisState {
  const [state, setState] = useState<SchemaAnalysisState>({
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

    analyzeSchema(repositoryUrl)
      .then((analysis) => {
        if (!cancelled) setState({ status: "success", analysis, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        requestedFor.current = null;
        setState({
          status: "error",
          analysis: null,
          error: caught instanceof Error ? caught.message : "Failed to analyze schema",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, repositoryUrl, enabled]);

  return state;
}
