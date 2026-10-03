import { useCallback, useRef, useState } from "react";

export type OnDemandStatus = "idle" | "loading" | "success" | "error";

export interface OnDemandState<T> {
  status: OnDemandStatus;
  data: T | null;
  error: string | null;
}

export interface UseOnDemandResourceResult<T> extends OnDemandState<T> {
  /** Runs `fetcher`, keyed by `key`. A key already in the in-memory cache
   *  resolves instantly with no request and no loading flicker. */
  run: (key: string, fetcher: () => Promise<T>) => void;
  /** Clears the in-memory cache and resets to idle — used on repository re-analysis. */
  reset: () => void;
}

/**
 * Shared "fetch on explicit user action" hook for Phase 7's secondary
 * sections (commit detail, compare, file history, hotspots/contributors,
 * impact analysis) — unlike the main Evolution Timeline, none of these load
 * automatically when the History tab opens; each starts only when the user
 * selects a commit, clicks Compare, clicks a hotspot, or clicks Analyze
 * Impact (progressive disclosure, spec section 17).
 *
 * A small in-memory cache, keyed by whatever string the caller builds (a
 * sha, a `base...head` pair, …), means flipping back to something already
 * fetched in this session is instant and makes no request at all. The
 * backend keeps its own short-lived cache underneath this one (see
 * `scopedCache.ts`), so even a genuine re-fetch is often a fast hit there
 * rather than a fresh GitHub call — the two layers reinforce each other
 * rather than duplicating one concern.
 */
export function useOnDemandResource<T>(): UseOnDemandResourceResult<T> {
  const [state, setState] = useState<OnDemandState<T>>({
    status: "idle",
    data: null,
    error: null,
  });

  const cache = useRef(new Map<string, T>());
  // The key a resolved/in-flight request belongs to, so a response from a
  // superseded call (the user moved on before it returned) is discarded.
  const activeKey = useRef<string | null>(null);
  // The key currently in flight, specifically — read via a ref rather than
  // `state.status` because `run` is memoized with an empty dependency array
  // (deliberately, so callers can treat it as a stable function); a ref
  // never goes stale the way a value closed over from the first render would.
  const loadingKey = useRef<string | null>(null);

  const run = useCallback((key: string, fetcher: () => Promise<T>) => {
    const cached = cache.current.get(key);
    if (cached !== undefined) {
      activeKey.current = key;
      loadingKey.current = null;
      setState({ status: "success", data: cached, error: null });
      return;
    }

    if (loadingKey.current === key) return; // already in flight for this key

    activeKey.current = key;
    loadingKey.current = key;
    setState({ status: "loading", data: null, error: null });

    fetcher()
      .then((data) => {
        if (activeKey.current !== key) return; // superseded by a newer call
        loadingKey.current = null;
        cache.current.set(key, data);
        setState({ status: "success", data, error: null });
      })
      .catch((caught: unknown) => {
        if (activeKey.current !== key) return;
        loadingKey.current = null;
        setState({
          status: "error",
          data: null,
          error: caught instanceof Error ? caught.message : "Request failed",
        });
      });
  }, []);

  const reset = useCallback(() => {
    cache.current.clear();
    activeKey.current = null;
    loadingKey.current = null;
    setState({ status: "idle", data: null, error: null });
  }, []);

  return { ...state, run, reset };
}
