/**
 * Tests the sign-in route when GitHub credentials ARE configured.
 *
 * The credentials below are obvious fakes, set in this process only. No real
 * GitHub credentials are used and no request reaches GitHub: the route is
 * expected to answer with a redirect, which is produced locally.
 *
 * Run with:  npx tsx src/auth/authConfigured.test.ts
 */
const FAKE_CLIENT_ID = "Iv1.0000000000000000";
const FAKE_CLIENT_SECRET = "fake-client-secret-not-a-real-credential";

// Must be set before config is imported: env is read once at module load.
// dotenv does not override variables that are already present.
process.env.GITHUB_APP_CLIENT_ID = FAKE_CLIENT_ID;
process.env.GITHUB_APP_CLIENT_SECRET = FAKE_CLIENT_SECRET;

import type { AddressInfo } from "node:net";
import { assert, assertEqual, report, test } from "../testHarness.js";

const { createApp } = await import("../app.js");
const { inspectGithubAppConfig } = await import("./githubApp.js");
const { GITHUB_CALLBACK_PATH } = await import("../config/env.js");

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

async function startAuth(): Promise<Response> {
  return fetch(`${base}/api/auth/github`, { redirect: "manual" });
}

test("configuration is detected as complete", () => {
  assertEqual(inspectGithubAppConfig().status, "configured", "configured");
});

test("the route starts the OAuth flow instead of reporting 'not configured'", async () => {
  const res = await startAuth();
  assert(res.status >= 300 && res.status < 400, `a redirect, got ${res.status}`);

  const location = res.headers.get("location") ?? "";
  assert(
    location.startsWith("https://github.com/login/oauth/authorize"),
    `redirects to GitHub's authorization page: ${location}`
  );
});

test("the authorization URL carries the client id, callback and a state", async () => {
  const location = (await startAuth()).headers.get("location") ?? "";
  const url = new URL(location);

  assertEqual(url.searchParams.get("client_id"), FAKE_CLIENT_ID, "client id");
  assertEqual(
    url.searchParams.get("redirect_uri"),
    `http://localhost:5000${GITHUB_CALLBACK_PATH}`,
    "callback URL defaults to this backend's own route"
  );

  const state = url.searchParams.get("state") ?? "";
  assert(state.length >= 40, `state is substantial, got ${state.length} chars`);
  assert(/^[A-Za-z0-9_-]+$/.test(state), `state looks random: ${state}`);
});

test("the client secret never appears in the redirect or any response", async () => {
  const res = await startAuth();
  const location = res.headers.get("location") ?? "";
  const headers = JSON.stringify([...res.headers.entries()]);
  const body = await res.text();

  for (const text of [location, headers, body]) {
    assert(!text.includes(FAKE_CLIENT_SECRET), "secret is never sent to the browser");
    assert(!text.includes("client_secret"), "no client_secret parameter is exposed");
  }
});

test("each authorization start issues a fresh, unguessable state", async () => {
  const states = new Set<string>();
  for (let i = 0; i < 25; i++) {
    const location = (await startAuth()).headers.get("location") ?? "";
    states.add(new URL(location).searchParams.get("state") ?? "");
  }
  assertEqual(states.size, 25, "every state is unique");
});

test("an unsolicited callback is still rejected when configured", async () => {
  // A forged state must not be accepted just because credentials now exist.
  const res = await fetch(
    `${base}${GITHUB_CALLBACK_PATH}?code=abc&state=forged-state-value`,
    { redirect: "manual" }
  );
  const location = res.headers.get("location") ?? "";
  assert(location.includes("auth=error"), `rejected: ${location}`);
  assert(
    location.startsWith("http://localhost:5173"),
    `redirect stays on the configured frontend: ${location}`
  );
});

test("/api/auth/me still reports signed out until the flow completes", async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assertEqual(res.status, 200, "200");
  const body = (await res.json()) as { data: { user: unknown } };
  assertEqual(body.data.user, null, "no session yet");
});

test("public repository analysis is unaffected by credentials being present", async () => {
  const res = await fetch(`${base}/api/github/tree`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/x" }),
  });
  assertEqual(res.status, 400, "validation unchanged");
});

await report("GitHub sign-in configured-route tests");
server.close();
