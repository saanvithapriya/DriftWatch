/**
 * Tests for the shared TTL + LRU + credential-scoped cache (Phase 7).
 *
 * Run with:  npx tsx src/services/scopedCache.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { callerIdentity, createScopedCache } from "./scopedCache.js";

test("a stored value is returned on a subsequent get", () => {
  const cache = createScopedCache<string>(60_000, 10);
  cache.set("a", "value");
  assertEqual(cache.get("a"), "value", "hit");
});

test("a miss returns null, never undefined or a thrown error", () => {
  const cache = createScopedCache<string>(60_000, 10);
  assertEqual(cache.get("missing"), null, "clean miss");
});

test("an entry older than the TTL is treated as a miss", async () => {
  const cache = createScopedCache<string>(10, 10);
  cache.set("a", "value");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEqual(cache.get("a"), null, "expired");
});

test("the oldest entry is evicted once the cache is full", () => {
  const cache = createScopedCache<number>(60_000, 3);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.set("d", 4); // evicts "a", the oldest
  assertEqual(cache.get("a"), null, "evicted");
  assertEqual(cache.get("d"), 4, "newest present");
  assertEqual(cache.get("b"), 2, "still present");
});

test("reading an entry refreshes its recency, protecting it from eviction", () => {
  const cache = createScopedCache<number>(60_000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a"); // "a" is now more recent than "b"
  cache.set("c", 3); // should evict "b", the now-oldest
  assertEqual(cache.get("a"), 1, "protected by the read");
  assertEqual(cache.get("b"), null, "evicted instead");
});

// ── callerIdentity ───────────────────────────────────────────────────────

test("no credential maps to a fixed anonymous identity", () => {
  assertEqual(callerIdentity(undefined), "anonymous", "fixed marker");
});

test("a credential maps to a hash, never the raw token", () => {
  const identity = callerIdentity({ token: "ghu_supersecrettoken1234567890" });
  assert(!identity.includes("ghu_supersecrettoken1234567890"), "raw token never present");
  assertEqual(identity.length, 64, "sha256 hex digest length");
});

test("two different credentials produce two different identities", () => {
  const a = callerIdentity({ token: "token-a" });
  const b = callerIdentity({ token: "token-b" });
  assert(a !== b, "distinct identities, so one user's cache can never serve another's");
});

test("the same credential always produces the same identity", () => {
  const a = callerIdentity({ token: "same-token" });
  const b = callerIdentity({ token: "same-token" });
  assertEqual(a, b, "deterministic");
});

await report("Scoped cache tests");
