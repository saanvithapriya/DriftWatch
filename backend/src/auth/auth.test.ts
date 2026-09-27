/**
 * Tests for the GitHub App authorization flow, sessions and CSRF state.
 *
 * GitHub is mocked through the GithubAuthProvider interface, so no network
 * access, no real credentials and no interactive browser login are involved.
 *
 * Run with:  npx tsx src/auth/auth.test.ts
 */
import { AppError } from "../utils/appError.js";
import { assert, assertEqual, report, test } from "../testHarness.js";
import { createAuthService } from "./authService.js";
import type { GithubAuthProvider, SessionUser } from "./authTypes.js";
import {
  createInMemorySessionStore,
  createInMemoryStateStore,
} from "./sessionService.js";

const USER: SessionUser = {
  id: 42,
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://example.test/avatar.png",
};

const SECRET_TOKEN = "ghu_secret_user_token_value";

interface FakeProvider extends GithubAuthProvider {
  calls: { exchanged: string[]; revoked: string[] };
  failExchange: boolean;
  failUser: boolean;
}

function fakeProvider(): FakeProvider {
  const provider: FakeProvider = {
    calls: { exchanged: [], revoked: [] },
    failExchange: false,
    failUser: false,

    getAuthorizationUrl(state) {
      return `https://github.test/login/oauth/authorize?client_id=abc&state=${state}`;
    },
    async exchangeCode(code) {
      provider.calls.exchanged.push(code);
      if (provider.failExchange) throw new Error("bad code (client_secret=shhh)");
      return { token: SECRET_TOKEN };
    },
    async fetchUser() {
      if (provider.failUser) throw new Error("bad token");
      return USER;
    },
    async revoke(credential) {
      provider.calls.revoked.push(credential.token);
    },
  };
  return provider;
}

function makeService(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const provider = fakeProvider();
  const sessions = createInMemorySessionStore(1000 * 60 * 60, now);
  const states = createInMemoryStateStore(1000 * 60, now);
  const auth = createAuthService({ provider, sessions, states });
  return { provider, sessions, states, auth };
}

/** Pulls the `state` query parameter out of an authorization URL. */
function stateFrom(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
}

// ── authorization route ──────────────────────────────────────────────────

test("beginAuthorization returns a GitHub URL carrying a state", () => {
  const { auth } = makeService();
  const { url } = auth.beginAuthorization();
  assert(url.startsWith("https://github.test/"), "points at GitHub");
  assert(stateFrom(url).length >= 32, "carries a substantial state value");
});

test("state values are unguessable and never repeat", () => {
  const { auth } = makeService();
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    seen.add(stateFrom(auth.beginAuthorization().url));
  }
  assertEqual(seen.size, 200, "every state is unique");
  for (const state of seen) {
    assert(/^[A-Za-z0-9_-]{40,}$/.test(state), `looks random: ${state}`);
  }
});

// ── callback state validation ────────────────────────────────────────────

async function expectRejected(
  run: () => Promise<unknown>,
  label: string
): Promise<AppError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AppError, `${label}: an AppError was thrown`);
  return caught as AppError;
}

test("a callback with no state is rejected", async () => {
  const { auth } = makeService();
  auth.beginAuthorization();
  const error = await expectRejected(
    () => auth.completeAuthorization("code123", undefined),
    "missing state"
  );
  assertEqual(error.statusCode, 400, "400");
});

test("a callback with an unknown state is rejected", async () => {
  const { auth } = makeService();
  auth.beginAuthorization();
  const error = await expectRejected(
    () => auth.completeAuthorization("code123", "forged-state-value"),
    "invalid state"
  );
  assertEqual(error.statusCode, 400, "400");
});

test("a state cannot be reused", async () => {
  const { auth } = makeService();
  const state = stateFrom(auth.beginAuthorization().url);

  const session = await auth.completeAuthorization("code123", state);
  assert(session.id.length > 0, "first use succeeds");

  const error = await expectRejected(
    () => auth.completeAuthorization("code456", state),
    "replayed state"
  );
  assertEqual(error.statusCode, 400, "replay rejected");
});

test("an expired state is rejected", async () => {
  let clock = 1_000_000;
  const { auth } = makeService({ now: () => clock });
  const state = stateFrom(auth.beginAuthorization().url);
  clock += 1000 * 60 * 60; // well past the state TTL
  const error = await expectRejected(
    () => auth.completeAuthorization("code123", state),
    "expired state"
  );
  assertEqual(error.statusCode, 400, "400");
});

test("a callback with a valid state but no code is rejected", async () => {
  const { auth } = makeService();
  const state = stateFrom(auth.beginAuthorization().url);
  const error = await expectRejected(
    () => auth.completeAuthorization(undefined, state),
    "missing code"
  );
  assertEqual(error.statusCode, 400, "400");
});

test("the code is never exchanged when the state is invalid", async () => {
  const { auth, provider } = makeService();
  auth.beginAuthorization();
  await expectRejected(
    () => auth.completeAuthorization("code123", "forged"),
    "invalid state"
  );
  assertEqual(provider.calls.exchanged.length, 0, "no exchange attempted");
});

// ── successful callback ──────────────────────────────────────────────────

test("a valid callback creates a session holding the credential", async () => {
  const { auth, sessions } = makeService();
  const state = stateFrom(auth.beginAuthorization().url);
  const session = await auth.completeAuthorization("code123", state);

  assertEqual(session.user.login, "octocat", "user resolved");
  assertEqual(session.credential.token, SECRET_TOKEN, "credential stored server-side");
  assert(session.id.length >= 40, "opaque session id");
  assertEqual(sessions.size(), 1, "one session stored");
  assert(auth.getSession(session.id) !== null, "session is retrievable");
});

test("session ids are unguessable and unique", async () => {
  const { auth } = makeService();
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const state = stateFrom(auth.beginAuthorization().url);
    ids.add((await auth.completeAuthorization("c", state)).id);
  }
  assertEqual(ids.size, 50, "all distinct");
  for (const id of ids) assert(/^[A-Za-z0-9_-]{40,}$/.test(id), "opaque id");
});

// ── failed callback ──────────────────────────────────────────────────────

test("a failed code exchange yields a clean 401 and leaks nothing", async () => {
  const { auth, provider, sessions } = makeService();
  provider.failExchange = true;
  const state = stateFrom(auth.beginAuthorization().url);

  const error = await expectRejected(
    () => auth.completeAuthorization("code123", state),
    "exchange failure"
  );
  assertEqual(error.statusCode, 401, "401");
  assert(!error.message.includes("client_secret"), "client secret not echoed");
  assert(!error.message.includes("shhh"), "underlying detail not echoed");
  assertEqual(sessions.size(), 0, "no session created");
});

test("a failed user lookup yields a clean 401 and creates no session", async () => {
  const { auth, provider, sessions } = makeService();
  provider.failUser = true;
  const state = stateFrom(auth.beginAuthorization().url);

  const error = await expectRejected(
    () => auth.completeAuthorization("code123", state),
    "user lookup failure"
  );
  assertEqual(error.statusCode, 401, "401");
  assertEqual(sessions.size(), 0, "no session created");
});

// ── sessions ─────────────────────────────────────────────────────────────

test("an unknown session id resolves to null", () => {
  const { auth } = makeService();
  assertEqual(auth.getSession("not-a-session"), null, "null");
});

test("an expired session resolves to null and is evicted", async () => {
  let clock = 5_000_000;
  const { auth, sessions } = makeService({ now: () => clock });
  const state = stateFrom(auth.beginAuthorization().url);
  const session = await auth.completeAuthorization("code123", state);

  assert(auth.getSession(session.id) !== null, "valid before expiry");
  clock += 1000 * 60 * 60 * 24; // past the session TTL
  assertEqual(auth.getSession(session.id), null, "expired");
  assertEqual(sessions.size(), 0, "evicted from the store");
});

test("logout destroys the session and revokes the credential", async () => {
  const { auth, provider, sessions } = makeService();
  const state = stateFrom(auth.beginAuthorization().url);
  const session = await auth.completeAuthorization("code123", state);

  await auth.logout(session.id);
  assertEqual(auth.getSession(session.id), null, "session gone");
  assertEqual(sessions.size(), 0, "store empty");
  assertEqual(provider.calls.revoked, [SECRET_TOKEN], "credential revoked at GitHub");
});

test("logout of an unknown session is harmless", async () => {
  const { auth, provider } = makeService();
  await auth.logout("not-a-session");
  assertEqual(provider.calls.revoked.length, 0, "nothing revoked");
});

test("sessions are isolated: one user's credential is never served to another", async () => {
  const { auth, provider } = makeService();
  const stateA = stateFrom(auth.beginAuthorization().url);
  const a = await auth.completeAuthorization("codeA", stateA);

  // A second user authorizes with a different credential.
  provider.exchangeCode = async () => ({ token: "ghu_other_user" });
  const stateB = stateFrom(auth.beginAuthorization().url);
  const b = await auth.completeAuthorization("codeB", stateB);

  assert(a.id !== b.id, "distinct sessions");
  assertEqual(auth.getSession(a.id)?.credential.token, SECRET_TOKEN, "A keeps its own credential");
  assertEqual(auth.getSession(b.id)?.credential.token, "ghu_other_user", "B keeps its own");
});

await report("GitHub App authorization / session tests");
