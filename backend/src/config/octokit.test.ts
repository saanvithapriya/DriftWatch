/**
 * Tests for credential isolation in the Octokit factory.
 *
 * These assert the property that matters most in Phase 3: one user's
 * credential can never end up serving another user's request. No network
 * access is involved — `octokit.auth()` reports the attached credential
 * locally.
 *
 * Run with:  npx tsx src/config/octokit.test.ts
 */
import {
  getAuthenticatedOctokit,
  getOctokit,
  resetAnonymousOctokit,
  resolveOctokit,
  throttleOptions,
} from "./octokit.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

interface TokenAuth {
  type: string;
  token?: string;
}

async function authOf(client: { auth: () => Promise<unknown> }): Promise<TokenAuth> {
  return (await client.auth()) as TokenAuth;
}

test("the anonymous client is reused across calls", () => {
  resetAnonymousOctokit();
  const a = getOctokit();
  const b = getOctokit();
  assert(a === b, "same cached instance");
});

test("an authenticated client is never the anonymous client", () => {
  const anon = getOctokit();
  const authed = getAuthenticatedOctokit({ token: "ghu_alice" });
  assert(anon !== authed, "distinct instances");
});

test("authenticated clients are not cached, so credentials cannot be shared", () => {
  const first = getAuthenticatedOctokit({ token: "ghu_alice" });
  const second = getAuthenticatedOctokit({ token: "ghu_alice" });
  assert(first !== second, "a fresh client each time, never a shared cache");
});

test("two users never receive the same client", () => {
  const alice = getAuthenticatedOctokit({ token: "ghu_alice" });
  const bob = getAuthenticatedOctokit({ token: "ghu_bob" });
  assert(alice !== bob, "distinct instances per credential");
});

test("each client actually carries its own credential", async () => {
  const alice = await authOf(getAuthenticatedOctokit({ token: "ghu_alice" }));
  const bob = await authOf(getAuthenticatedOctokit({ token: "ghu_bob" }));
  assertEqual(alice.token, "ghu_alice", "alice's token");
  assertEqual(bob.token, "ghu_bob", "bob's token");
  assert(alice.token !== bob.token, "credentials are not mixed");
});

test("requesting Bob's client does not mutate Alice's", async () => {
  const aliceClient = getAuthenticatedOctokit({ token: "ghu_alice" });
  getAuthenticatedOctokit({ token: "ghu_bob" });
  const aliceAuth = await authOf(aliceClient);
  assertEqual(aliceAuth.token, "ghu_alice", "still alice's credential");
});

test("resolveOctokit with no credential returns the anonymous client", async () => {
  resetAnonymousOctokit();
  const resolved = resolveOctokit();
  assert(resolved === getOctokit(), "the shared anonymous client");

  const auth = await authOf(resolved);
  assert(
    auth.type === "unauthenticated" || auth.token === process.env.GITHUB_TOKEN,
    `no user credential attached, got ${auth.type}`
  );
});

test("resolveOctokit with a credential returns an authenticated client", async () => {
  const resolved = resolveOctokit({ token: "ghu_carol" });
  assert(resolved !== getOctokit(), "not the anonymous client");
  assertEqual((await authOf(resolved)).token, "ghu_carol", "carol's token");
});

test("an anonymous request after an authenticated one is still anonymous", async () => {
  // Guards against a regression where the factory caches the last client used.
  resetAnonymousOctokit();
  resolveOctokit({ token: "ghu_dave" });
  const anonymous = resolveOctokit();
  const auth = await authOf(anonymous);
  assert(auth.token !== "ghu_dave", "dave's credential did not leak into the anonymous path");
});

test("rate limiting is never retried, so a request cannot hang", () => {
  // Regression: the throttling plugin bundled with `octokit` defaults to
  // waiting for the rate-limit window to reset and retrying. With the
  // anonymous limit of 60/hour that made requests hang for many minutes
  // instead of returning a prompt 429, leaving the UI on a spinner.
  assertEqual(throttleOptions.onRateLimit(), false, "primary rate limit is not retried");
  assertEqual(
    throttleOptions.onSecondaryRateLimit(),
    false,
    "secondary rate limit is not retried"
  );
});

await report("Octokit credential isolation tests");
