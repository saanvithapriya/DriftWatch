/**
 * Tests the sign-in route when GitHub credentials are only HALF configured —
 * the common case of a typo or an unfinished .env.
 *
 * The client id below is an obvious fake, set in this process only.
 *
 * Run with:  npx tsx src/auth/authPartial.test.ts
 */
const FAKE_CLIENT_ID = "Iv1.0000000000000000";

// Set before config is imported: a client id with no secret.
process.env.GITHUB_APP_CLIENT_ID = FAKE_CLIENT_ID;
delete process.env.GITHUB_APP_CLIENT_SECRET;

import type { AddressInfo } from "node:net";
import { assert, assertEqual, report, test } from "../testHarness.js";

const { createApp } = await import("../app.js");
const { inspectGithubAppConfig } = await import("./githubApp.js");

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

test("half-configured credentials are detected as partial", () => {
  const config = inspectGithubAppConfig();
  assertEqual(config.status, "partial", "partial");
  assertEqual(
    config.status === "partial" ? config.missing : [],
    ["GITHUB_APP_CLIENT_SECRET"],
    "names exactly what is missing"
  );
});

test("the route reports a misconfiguration, distinct from 'not configured'", async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  assertEqual(res.status, 503, "503");

  const body = (await res.json()) as { success: boolean; message: string };
  assertEqual(body.success, false, "error envelope");
  assert(
    body.message.includes("misconfigured"),
    `says misconfigured, not unconfigured: ${body.message}`
  );
  assert(
    !body.message.includes("not configured"),
    "distinguishable from the unconfigured case"
  );
});

test("the client-facing message names no variable and no value", async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  const text = await res.text();

  assert(!text.includes(FAKE_CLIENT_ID), "no credential value in the response");
  assert(!text.includes("GITHUB_APP_CLIENT"), "variable names stay in the server log");
});

test("no OAuth flow is started while configuration is incomplete", async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  assert(res.status < 300 || res.status >= 400, "never redirects to GitHub");
  assertEqual(res.headers.get("location"), null, "no Location header");
});

test("public repository analysis still works while half configured", async () => {
  assertEqual((await fetch(`${base}/api/health`)).status, 200, "health unaffected");

  const me = await fetch(`${base}/api/auth/me`);
  assertEqual(
    ((await me.json()) as { data: { user: unknown } }).data.user,
    null,
    "signed out, not broken"
  );

  const tree = await fetch(`${base}/api/github/tree`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/x" }),
  });
  assertEqual(tree.status, 400, "validation unchanged");
});

await report("GitHub sign-in partial-configuration tests");
server.close();
