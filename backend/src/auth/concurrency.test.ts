/**
 * Concurrency tests: parallel sessions, parallel anonymous/authenticated
 * clients, and the session store under interleaved use.
 *
 * Run with:  npx tsx src/auth/concurrency.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import {
  getAuthenticatedOctokit,
  getOctokit,
  resetAnonymousOctokit,
  resolveOctokit,
} from "../config/octokit.js";
import { assert, assertEqual, report, test } from "../testHarness.js";
import { sessionStore } from "./authRuntime.js";
import { SESSION_COOKIE_NAME } from "./sessionCookie.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

interface TokenAuth {
  type: string;
  token?: string;
}

async function authOf(client: { auth: () => Promise<unknown> }): Promise<TokenAuth> {
  return (await client.auth()) as TokenAuth;
}

function makeSession(login: string, token: string) {
  return sessionStore.create(
    { id: login.length, login, name: login, avatarUrl: `https://x/${login}.png` },
    { token }
  );
}

// ── client isolation under interleaving ──────────────────────────────────

test("interleaved anonymous and authenticated clients never share a credential", async () => {
  resetAnonymousOctokit();

  const sequence = [
    undefined,
    { token: "ghu_alice" },
    undefined,
    { token: "ghu_bob" },
    undefined,
    { token: "ghu_alice" },
  ] as const;

  const results = await Promise.all(
    sequence.map(async (credential) => {
      const client = resolveOctokit(credential);
      const auth = await authOf(client);
      return { expected: credential?.token, actual: auth.token };
    })
  );

  for (const { expected, actual } of results) {
    if (expected === undefined) {
      assert(
        actual !== "ghu_alice" && actual !== "ghu_bob",
        `anonymous client carried no user credential, got ${actual}`
      );
    } else {
      assertEqual(actual, expected, "authenticated client kept its own credential");
    }
  }
});

test("many parallel authenticated clients each keep their own token", async () => {
  const tokens = Array.from({ length: 50 }, (_, i) => `ghu_user_${i}`);
  const results = await Promise.all(
    tokens.map(async (token) => (await authOf(getAuthenticatedOctokit({ token }))).token)
  );
  assertEqual(results, tokens, "no crossover under parallel construction");
});

test("the anonymous client is still shared, and still anonymous, after heavy authenticated use", async () => {
  resetAnonymousOctokit();
  const before = getOctokit();

  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      authOf(getAuthenticatedOctokit({ token: `ghu_parallel_${i}` }))
    )
  );

  const after = getOctokit();
  assert(before === after, "still the same cached instance");
  const auth = await authOf(after);
  assert(
    auth.token === undefined || !auth.token.startsWith("ghu_parallel_"),
    `no authenticated credential leaked into the anonymous client, got ${auth.token}`
  );
});

// ── parallel sessions over HTTP ──────────────────────────────────────────

test("parallel requests with different sessions each get their own user", async () => {
  const users = ["alice", "bob", "carol", "dave", "erin"];
  const sessions = users.map((login) => makeSession(login, `ghu_${login}`));

  const results = await Promise.all(
    sessions.map(async (session) => {
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.id}` },
      });
      const body = (await res.json()) as { data: { user: { login: string } | null } };
      return body.data.user?.login;
    })
  );

  assertEqual(results, users, "each request saw its own user");
});

test("repeated parallel requests on one session stay consistent", async () => {
  const session = makeSession("frank", "ghu_frank");
  const results = await Promise.all(
    Array.from({ length: 25 }, async () => {
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.id}` },
      });
      const body = (await res.json()) as { data: { user: { login: string } | null } };
      return body.data.user?.login;
    })
  );
  assert(
    results.every((login) => login === "frank"),
    "every parallel read saw the same user"
  );
});

test("a session destroyed mid-flight stops authenticating", async () => {
  const session = makeSession("grace", "ghu_grace");
  const cookie = { cookie: `${SESSION_COOKIE_NAME}=${session.id}` };

  const before = await fetch(`${base}/api/auth/me`, { headers: cookie });
  const beforeBody = (await before.json()) as { data: { user: unknown } };
  assert(beforeBody.data.user !== null, "authenticated first");

  sessionStore.delete(session.id);

  const results = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const res = await fetch(`${base}/api/auth/me`, { headers: cookie });
      const body = (await res.json()) as { data: { user: unknown } };
      return body.data.user;
    })
  );
  assert(
    results.every((user) => user === null),
    "no request authenticated after destruction"
  );
});

test("one session's data never appears in another session's response", async () => {
  const alice = makeSession("alice2", "ghu_alice2");
  const bob = makeSession("bob2", "ghu_bob2");

  const [aliceRes, bobRes] = await Promise.all([
    fetch(`${base}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.id}` } }),
    fetch(`${base}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${bob.id}` } }),
  ]);

  const aliceText = await aliceRes.text();
  const bobText = await bobRes.text();

  assert(aliceText.includes("alice2") && !aliceText.includes("bob2"), "alice saw only herself");
  assert(bobText.includes("bob2") && !bobText.includes("alice2"), "bob saw only himself");
  for (const text of [aliceText, bobText]) {
    assert(!text.includes("ghu_"), "no credential in either response");
  }
});

test("an attacker-chosen session id is never adopted", async () => {
  // Session fixation: presenting an id the server never issued must not work.
  const chosen = "attacker-chosen-session-id";
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${chosen}` },
  });
  const body = (await res.json()) as { data: { user: unknown } };
  assertEqual(body.data.user, null, "not authenticated");
  assertEqual(sessionStore.get(chosen), null, "no session was created for it");
});

await report("concurrency and session isolation tests");
server.close();
