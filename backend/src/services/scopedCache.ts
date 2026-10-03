import { createHash } from "node:crypto";
import type { GithubCredential } from "../types/github.js";

/**
 * A short-lived, size-bounded, credential-scoped in-memory cache.
 *
 * Generalizes the pattern Phase 6's call-graph service introduced: entries
 * expire after a TTL, the oldest entry is evicted once the cache is full
 * (simple LRU via re-insertion on access), and every key is namespaced by the
 * caller's identity — a hash of their credential, or a fixed anonymous
 * marker — never the raw token.
 *
 * This is what keeps "switching the selected commit" or "re-opening a tab"
 * cheap without risking the one mistake that matters here: once private
 * repositories are reachable, a cache keyed on the repository alone is a
 * data leak between users who are not equally entitled to see it (see the
 * warning in `githubService.ts`). Every cache built from this module avoids
 * that by construction.
 */
export interface ScopedCache<V> {
  get(key: string): V | null;
  set(key: string, value: V): void;
}

export function createScopedCache<V>(ttlMs: number, maxEntries: number): ScopedCache<V> {
  const store = new Map<string, { value: V; builtAt: number }>();

  return {
    get(key: string): V | null {
      const entry = store.get(key);
      if (entry === undefined) return null;
      if (Date.now() - entry.builtAt > ttlMs) {
        store.delete(key);
        return null;
      }
      // Refresh recency for the LRU eviction below.
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },

    set(key: string, value: V): void {
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, builtAt: Date.now() });
    },
  };
}

/** The caller's identity for cache namespacing — never the raw token. */
export function callerIdentity(credential?: GithubCredential): string {
  if (credential === undefined) return "anonymous";
  return createHash("sha256").update(credential.token).digest("hex");
}
