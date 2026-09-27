/**
 * HTTP-level tests for the auth routes, cookie flags and CORS.
 *
 * The real Express app is booted in-process on an ephemeral port. No GitHub
 * App is configured, so the authorization route reports itself unavailable and
 * sessions are injected directly into the store — no network, no browser.
 *
 * Run with:  npx tsx src/auth/authHttp.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";
import { sessionStore } from "./authRuntime.js";
import { SESSION_COOKIE_NAME } from "./sessionCookie.js";

const SECRET_TOKEN = "ghu_super_secret_token_abcdef123456";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

function newSession() {
  return sessionStore.create(
    {
      id: 7,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.test/a.png",
    },
    { token: SECRET_TOKEN }
  );
}

function cookieHeader(id: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${id}` };
}

/** Reads a JSON body as a loosely-typed record, which is all the assertions need. */
async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

/** Parses the attributes of the Set-Cookie header for our session cookie. */
function sessionSetCookie(res: Response): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? null;
}

// ── /api/auth/me ─────────────────────────────────────────────────────────

test("GET /api/auth/me while logged out reports no user", async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assertEqual(res.status, 200, "200");
  const body = await json(res);
  assertEqual(body, { success: true, data: { user: null } }, "no user");
});

test("GET /api/auth/me while logged in returns only safe profile fields", async () => {
  const session = newSession();
  const res = await fetch(`${base}/api/auth/me`, { headers: cookieHeader(session.id) });
  assertEqual(res.status, 200, "200");

  const body = await json(res);
  assertEqual(
    body,
    {
      success: true,
      data: {
        user: {
          id: 7,
          login: "octocat",
          name: "The Octocat",
          avatarUrl: "https://example.test/a.png",
        },
      },
    },
    "exactly the safe fields"
  );
});

test("the GitHub credential never appears in any auth response", async () => {
  const session = newSession();
  for (const path of ["/api/auth/me", "/api/auth/logout"]) {
    const res = await fetch(`${base}${path}`, { headers: cookieHeader(session.id) });
    const text = await res.text();
    assert(!text.includes(SECRET_TOKEN), `token absent from ${path}`);
    assert(!text.includes("token"), `no token field in ${path}: ${text}`);
    assert(!text.includes("credential"), `no credential field in ${path}`);
  }
});

test("an unknown session cookie is treated as logged out and cleared", async () => {
  const res = await fetch(`${base}/api/auth/me`, { headers: cookieHeader("bogus-session-id") });
  const body = await json(res);
  assertEqual(body.data.user, null, "logged out");

  const setCookie = sessionSetCookie(res);
  assert(setCookie !== null, "the stale cookie is cleared");
});

// ── cookie security flags ────────────────────────────────────────────────

test("the session cookie is HttpOnly, SameSite=Lax and scoped to /", async () => {
  const session = newSession();
  const res = await fetch(`${base}/api/auth/logout`, { headers: cookieHeader(session.id) });
  const setCookie = sessionSetCookie(res);
  assert(setCookie !== null, "a Set-Cookie was issued");

  const cookie = setCookie as string;
  assert(/HttpOnly/i.test(cookie), `HttpOnly present: ${cookie}`);
  assert(/SameSite=Lax/i.test(cookie), `SameSite=Lax present: ${cookie}`);
  assert(/Path=\//i.test(cookie), `Path=/ present: ${cookie}`);
  assert(!cookie.includes(SECRET_TOKEN), "no credential in the cookie");
});

// ── logout ───────────────────────────────────────────────────────────────

test("GET /api/auth/logout destroys the session", async () => {
  const session = newSession();
  assert(sessionStore.get(session.id) !== null, "session exists first");

  const res = await fetch(`${base}/api/auth/logout`, { headers: cookieHeader(session.id) });
  assertEqual(res.status, 200, "200");
  assertEqual(sessionStore.get(session.id), null, "session destroyed");

  // The cookie no longer works.
  const after = await fetch(`${base}/api/auth/me`, { headers: cookieHeader(session.id) });
  assertEqual((await json(after)).data.user, null, "logged out");
});

test("logout destroys the session even with no GitHub App configured", async () => {
  // Regression: session destruction used to be routed through the auth
  // service, so logout silently did nothing when no provider existed.
  const session = newSession();
  await fetch(`${base}/api/auth/logout`, { headers: cookieHeader(session.id) });
  assertEqual(sessionStore.get(session.id), null, "session gone regardless of configuration");
});

test("logout without a session is still a clean 200", async () => {
  const res = await fetch(`${base}/api/auth/logout`);
  assertEqual(res.status, 200, "200");
});

// ── authorization route without configuration ────────────────────────────

test("GET /api/auth/github reports 503 when no GitHub App is configured", async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  assertEqual(res.status, 503, "503");
  const body = await json(res);
  assertEqual(body.success, false, "error envelope");
  assert(typeof body.message === "string", "has a message");
});

test("the callback without configuration redirects rather than erroring", async () => {
  const res = await fetch(`${base}/api/auth/github/callback?code=x&state=y`, {
    redirect: "manual",
  });
  assert(res.status >= 300 && res.status < 400, `a redirect, got ${res.status}`);
  const location = res.headers.get("location") ?? "";
  assert(location.includes("auth=error"), `signals failure: ${location}`);
  assert(
    location.startsWith("http://localhost:5173"),
    `redirects only to the configured frontend: ${location}`
  );
});

// ── Phase 0-2 routes are unaffected ──────────────────────────────────────

test("GET /api/health still works", async () => {
  const res = await fetch(`${base}/api/health`);
  assertEqual(res.status, 200, "200");
  assertEqual(await res.json(), { success: true, message: "Backend is running" }, "unchanged");
});

test("POST /api/github/tree still validates URLs anonymously", async () => {
  const res = await fetch(`${base}/api/github/tree`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/x" }),
  });
  assertEqual(res.status, 400, "400");
  assertEqual(
    await res.json(),
    { success: false, message: "Invalid GitHub repository URL" },
    "unchanged message"
  );
});

test("a client cannot smuggle its own credential through the request body", async () => {
  // The controller only ever reads the credential from the session.
  const res = await fetch(`${base}/api/github/tree`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/x", token: "ghu_attacker" }),
  });
  assertEqual(res.status, 400, "the extra field changes nothing");
});

// ── CORS ─────────────────────────────────────────────────────────────────

test("CORS allows the configured origin with credentials, never a wildcard", async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { origin: "http://localhost:5173" },
  });
  assertEqual(
    res.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
    "the configured origin"
  );
  assertEqual(
    res.headers.get("access-control-allow-credentials"),
    "true",
    "credentials enabled"
  );
  assert(
    res.headers.get("access-control-allow-origin") !== "*",
    "never a wildcard alongside credentials"
  );
});

await report("auth HTTP / cookie / CORS tests");
server.close();
