/**
 * HTTP-level tests for POST /api/github/dependencies.
 *
 * The real Express app is booted in-process. These cover everything that
 * happens before GitHub is contacted — validation, error envelopes, method
 * handling, credential handling — without any network access. The GitHub
 * failure paths (401/403/404/429/502) are covered by the shared error mapper
 * tests in services/githubService.test.ts, which every endpoint routes through.
 *
 * Run with:  npx tsx src/controllers/dependencyHttp.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;
const endpoint = `${base}/api/github/dependencies`;

async function post(body: string, contentType = "application/json") {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

test("an invalid GitHub URL is rejected with 400", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  assertEqual(res.status, 400, "400");
  assertEqual(
    await json(res),
    { success: false, message: "Invalid GitHub repository URL" },
    "shared Phase 1 validation message"
  );
});

test("URL validation matches the tree endpoint exactly", async () => {
  // Same rules, same rejections — validation is reused, not duplicated.
  const rejected = [
    "https://gitlab.com/a/b",
    "https://github.com/",
    "https://github.com/owner",
    "https://github.com/o/r/tree/main",
    "http://localhost:5000",
    "http://127.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "not a url",
    "",
  ];
  for (const url of rejected) {
    const res = await post(JSON.stringify({ url }));
    assertEqual(res.status, 400, `rejected: ${url}`);
  }
});

test("a missing or mistyped body is rejected with 400", async () => {
  for (const body of ["{}", '{"url":null}', '{"url":123}', '{"url":{}}', '{"url":[]}']) {
    const res = await post(body);
    assertEqual(res.status, 400, `rejected: ${body}`);
  }
});

test("malformed JSON is a controlled 400, not a crash", async () => {
  const res = await post('{"url": ');
  assertEqual(res.status, 400, "400");
  assertEqual(
    await json(res),
    { success: false, message: "Malformed JSON in request body" },
    "controlled error"
  );
});

test("a client cannot smuggle a GitHub credential through the body", async () => {
  const res = await post(
    JSON.stringify({ url: "https://example.com/x", token: "ghu_attacker", credential: "x" })
  );
  assertEqual(res.status, 400, "extra fields change nothing");
  const body = await json(res);
  assert(!JSON.stringify(body).includes("ghu_attacker"), "never echoed back");
});

test("only POST is accepted", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const res = await fetch(endpoint, { method });
    assertEqual(res.status, 404, `${method} rejected`);
  }
});

test("errors use the standard envelope and never leak internals", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  const body = await json(res);
  assertEqual(Object.keys(body).sort(), ["message", "success"], "exactly the envelope");
  assertEqual(body.success, false, "success false");
  const text = JSON.stringify(body);
  assert(!/at .*\.ts:|stack|Octokit|node_modules/i.test(text), "no stack or internals");
});

test("responses are JSON", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  assert(
    (res.headers.get("content-type") ?? "").includes("application/json"),
    "JSON content type"
  );
});

test("the Phase 1 tree endpoint is unaffected", async () => {
  const res = await fetch(`${base}/api/github/tree`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/x" }),
  });
  assertEqual(res.status, 400, "unchanged");
  assertEqual(
    await json(res),
    { success: false, message: "Invalid GitHub repository URL" },
    "unchanged message"
  );
});

test("health still works alongside the new route", async () => {
  const res = await fetch(`${base}/api/health`);
  assertEqual(res.status, 200, "200");
  assertEqual(await json(res), { success: true, message: "Backend is running" }, "unchanged");
});

await report("dependency endpoint HTTP tests");
server.close();
