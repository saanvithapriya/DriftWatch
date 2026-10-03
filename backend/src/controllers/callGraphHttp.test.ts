/**
 * HTTP-level tests for POST /api/github/call-graph.
 *
 * The real Express app is booted in-process. These cover everything before
 * GitHub is contacted — validation, envelopes, methods, credential handling —
 * with no network access, exactly like the tree/dependency/workflow endpoint
 * tests.
 *
 * Run with:  npx tsx src/controllers/callGraphHttp.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;
const endpoint = `${base}/api/github/call-graph`;

async function post(body: string, contentType = "application/json") {
  return fetch(endpoint, { method: "POST", headers: { "content-type": contentType }, body });
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

test("an invalid GitHub URL is rejected with the shared 400", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  assertEqual(res.status, 400, "400");
  assertEqual(
    await json(res),
    { success: false, message: "Invalid GitHub repository URL" },
    "shared Phase 1 validation message"
  );
});

test("URL validation matches the other endpoints exactly", async () => {
  const rejected = [
    "https://gitlab.com/a/b",
    "https://github.com/",
    "https://github.com/owner",
    "https://github.com/o/r/tree/main",
    "not a url",
    "",
  ];
  for (const url of rejected) {
    assertEqual((await post(JSON.stringify({ url }))).status, 400, `rejected: ${url}`);
  }
});

test("missing or mistyped bodies are 400, never 500", async () => {
  for (const body of ["{}", '{"url":null}', '{"url":123}', '{"url":{}}', '{"url":[]}']) {
    const res = await post(body);
    assertEqual(res.status, 400, `rejected: ${body}`);
    assertEqual((await json(res)).success, false, "error envelope");
  }
});

test("malformed JSON is a controlled 400", async () => {
  const res = await post('{"url": ');
  assertEqual(res.status, 400, "400");
  assertEqual((await json(res)).message, "Malformed JSON in request body", "controlled");
});

test("entryPoint may be omitted", async () => {
  // Validation only — the URL is invalid, so this never reaches GitHub, but it
  // proves an absent entryPoint is not itself rejected.
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  assertEqual(res.status, 400, "fails on the URL, not on the missing entryPoint");
});

test("a malformed entryPoint is rejected before any GitHub call", async () => {
  for (const entryPoint of [123, {}, [], true, ""]) {
    const res = await post(
      JSON.stringify({ url: "https://github.com/octocat/Hello-World", entryPoint })
    );
    assertEqual(res.status, 400, `rejected: ${JSON.stringify(entryPoint)}`);
    assertEqual((await json(res)).message, "Invalid entry point", "clear message");
  }
});

test("an oversized entryPoint is rejected", async () => {
  const res = await post(
    JSON.stringify({
      url: "https://github.com/octocat/Hello-World",
      entryPoint: "x".repeat(5000),
    })
  );
  assertEqual(res.status, 400, "rejected");
});

test("a client cannot supply its own GitHub credential", async () => {
  const res = await post(
    JSON.stringify({ url: "https://example.com/x", token: "ghu_attacker", credential: "x" })
  );
  assertEqual(res.status, 400, "extra fields change nothing");
  assert(!JSON.stringify(await json(res)).includes("ghu_attacker"), "never echoed");
});

test("only POST is accepted", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    assertEqual((await fetch(endpoint, { method })).status, 404, `${method} refused`);
  }
});

test("errors use the standard envelope and leak no internals", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  const body = await json(res);
  assertEqual(Object.keys(body).sort(), ["message", "success"], "exactly the envelope");
  const text = JSON.stringify(body);
  assert(!/node_modules|at .*\.ts:|Octokit|tree-sitter|stack/i.test(text), "no internals");
  assert(!/gh[pousr]_/.test(text), "no credential shapes");
});

test("responses are JSON", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x" }));
  assert(
    (res.headers.get("content-type") ?? "").includes("application/json"),
    "JSON content type"
  );
});

test("the earlier endpoints are unaffected", async () => {
  for (const path of ["/api/github/tree", "/api/github/dependencies", "/api/github/workflows"]) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    assertEqual(res.status, 400, `${path} unchanged`);
    assertEqual(
      (await json(res)).message,
      "Invalid GitHub repository URL",
      `${path} message unchanged`
    );
  }
});

test("health still works alongside the new route", async () => {
  const res = await fetch(`${base}/api/health`);
  assertEqual(res.status, 200, "200");
  assertEqual(await json(res), { success: true, message: "Backend is running" }, "unchanged");
});

await report("Call graph endpoint HTTP tests");
server.close();
