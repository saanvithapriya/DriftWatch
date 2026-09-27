/**
 * Tests for GitHub sign-in configuration: the three configuration states, the
 * callback-URL default, and the route's behaviour in each state.
 *
 * Credentials used here are obvious fakes. No real GitHub credentials are
 * required, read, or reachable from these tests.
 *
 * Run with:  npx tsx src/auth/authConfig.test.ts
 */
import type { AddressInfo } from "node:net";
import { assert, assertEqual, report, test } from "../testHarness.js";
import {
  GITHUB_CALLBACK_PATH,
  readGithubCallbackUrl,
} from "../config/env.js";
import { inspectGithubAppConfig, type GithubAppCredentials } from "./githubApp.js";

const CALLBACK = "http://localhost:5000/api/auth/github/callback";

const credentials = (
  overrides: Partial<GithubAppCredentials> = {}
): GithubAppCredentials => ({
  clientId: undefined,
  clientSecret: undefined,
  callbackUrl: CALLBACK,
  ...overrides,
});

// ── configuration states ─────────────────────────────────────────────────

test("no credentials at all is reported as unconfigured", () => {
  assertEqual(inspectGithubAppConfig(credentials()).status, "unconfigured", "unconfigured");
});

test("some but not all credentials is reported as partial, naming the gap", () => {
  const missingSecret = inspectGithubAppConfig(
    credentials({ clientId: "Iv1.fake-client-id" })
  );
  assertEqual(missingSecret.status, "partial", "partial");
  assertEqual(
    missingSecret.status === "partial" ? missingSecret.missing : [],
    ["GITHUB_APP_CLIENT_SECRET"],
    "names the missing variable"
  );

  const missingId = inspectGithubAppConfig(
    credentials({ clientSecret: "fake-client-secret" })
  );
  assertEqual(missingId.status, "partial", "partial the other way round");
  assertEqual(
    missingId.status === "partial" ? missingId.missing : [],
    ["GITHUB_APP_CLIENT_ID"],
    "names the missing variable"
  );
});

test("both credentials present is reported as configured", () => {
  const config = inspectGithubAppConfig(
    credentials({ clientId: "Iv1.fake-client-id", clientSecret: "fake-client-secret" })
  );
  assertEqual(config.status, "configured", "configured");
  assertEqual(
    config.status === "configured" ? config.callbackUrl : "",
    CALLBACK,
    "carries the callback URL"
  );
});

test("the reported gap never contains a credential value", () => {
  const config = inspectGithubAppConfig(
    credentials({ clientId: "Iv1.super-secret-id" })
  );
  const serialized = JSON.stringify(config);
  assert(!serialized.includes("super-secret-id"), "no value leaks into the report");
  assert(!serialized.includes("fake-client-secret"), "no secret leaks");
});

// ── callback URL ─────────────────────────────────────────────────────────

test("the callback URL defaults to this backend's own route", () => {
  assertEqual(
    readGithubCallbackUrl(undefined, 5000),
    `http://localhost:5000${GITHUB_CALLBACK_PATH}`,
    "derived from the port and the real route"
  );
  assertEqual(
    readGithubCallbackUrl("", 4000),
    `http://localhost:4000${GITHUB_CALLBACK_PATH}`,
    "follows a non-default port"
  );
});

test("an explicit callback URL is used as given", () => {
  assertEqual(
    readGithubCallbackUrl("https://driftwatch.example.com/api/auth/github/callback", 5000),
    "https://driftwatch.example.com/api/auth/github/callback",
    "explicit value wins"
  );
});

test("a malformed callback URL fails fast and names the variable", () => {
  for (const raw of ["not a url", "localhost:5000/cb", "ftp://example.com/cb", "javascript:alert(1)"]) {
    let message = "";
    try {
      readGithubCallbackUrl(raw, 5000);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(message.includes("GITHUB_APP_CALLBACK_URL"), `names the variable for ${raw}`);
  }
});

// ── the route in each state ──────────────────────────────────────────────

test("with no credentials the route reports that sign-in is not configured", async () => {
  // This process has no GitHub credentials in its environment.
  const { createApp } = await import("../app.js");
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/github`, {
      redirect: "manual",
    });
    assertEqual(res.status, 503, "503");

    const body = (await res.json()) as { success: boolean; message: string };
    assertEqual(body.success, false, "error envelope");
    assert(
      body.message.includes("not configured"),
      `distinguishes unconfigured from misconfigured: ${body.message}`
    );
  } finally {
    server.close();
  }
});

test("the app serves the callback path the default URL points at", async () => {
  // Guards against the constant drifting away from the real route.
  const { createApp } = await import("../app.js");
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}${GITHUB_CALLBACK_PATH}?code=x&state=y`, {
      redirect: "manual",
    });
    assert(res.status !== 404, `the callback route exists, got ${res.status}`);
  } finally {
    server.close();
  }
});

test("public repository analysis still works with no GitHub credentials", async () => {
  const { createApp } = await import("../app.js");
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/api/health`);
    assertEqual(health.status, 200, "health unaffected");

    const me = await fetch(`${base}/api/auth/me`);
    assertEqual(me.status, 200, "auth/me still answers");
    assertEqual(
      ((await me.json()) as { data: { user: unknown } }).data.user,
      null,
      "signed out"
    );

    // Validation still runs on every analysis endpoint without credentials.
    for (const path of ["/api/github/tree", "/api/github/dependencies", "/api/github/workflows"]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/x" }),
      });
      assertEqual(res.status, 400, `${path} still validates anonymously`);
    }
  } finally {
    server.close();
  }
});

await report("GitHub sign-in configuration tests");
