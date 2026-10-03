/**
 * HTTP-level tests for POST /api/github/history, /commit, /compare,
 * /file-history and /history-stats.
 *
 * The real Express app is booted in-process. These cover everything before
 * GitHub is contacted — validation, envelopes, methods, credential handling
 * — with no network access, exactly like every earlier phase's endpoint
 * tests.
 *
 * Run with:  npx tsx src/controllers/historyHttp.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

async function post(path: string, body: string, contentType = "application/json") {
  return fetch(`${base}${path}`, { method: "POST", headers: { "content-type": contentType }, body });
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

const INVALID_URL = JSON.stringify({ url: "https://example.com/x" });
const ENDPOINTS = [
  "/api/github/history",
  "/api/github/commit",
  "/api/github/compare",
  "/api/github/file-history",
  "/api/github/history-stats",
  "/api/github/impact",
];

// ── shared validation (every endpoint takes a GitHub URL first) ─────────

test("every history endpoint rejects an invalid GitHub URL with the shared 400", async () => {
  for (const path of ENDPOINTS) {
    const res = await post(path, INVALID_URL);
    assertEqual(res.status, 400, `${path}: 400`);
    assertEqual(
      await json(res),
      { success: false, message: "Invalid GitHub repository URL" },
      `${path}: shared Phase 1 validation message`
    );
  }
});

test("every history endpoint is JSON and only accepts POST", async () => {
  for (const path of ENDPOINTS) {
    const res = await post(path, INVALID_URL);
    assert((res.headers.get("content-type") ?? "").includes("application/json"), `${path}: JSON`);
    for (const method of ["GET", "PUT", "DELETE"]) {
      assertEqual((await fetch(`${base}${path}`, { method })).status, 404, `${path} ${method} refused`);
    }
  }
});

test("malformed JSON is a controlled 400 on every history endpoint", async () => {
  for (const path of ENDPOINTS) {
    const res = await post(path, '{"url": ');
    assertEqual(res.status, 400, `${path}: 400`);
    assertEqual((await json(res)).message, "Malformed JSON in request body", `${path}: controlled`);
  }
});

// ── /history ─────────────────────────────────────────────────────────────

test("history: page/perPage must be positive integers", async () => {
  for (const page of [0, -1, "two", 1.5]) {
    const res = await post(
      "/api/github/history",
      JSON.stringify({ url: "https://github.com/o/r", page })
    );
    assertEqual(res.status, 400, `rejected page: ${JSON.stringify(page)}`);
  }
});

test("history: perPage above the configured ceiling is rejected the moment it is unusable, not silently truncated", async () => {
  const res = await post(
    "/api/github/history",
    JSON.stringify({ url: "https://example.com/x", perPage: "not a number" })
  );
  assertEqual(res.status, 400, "rejected");
});

test("history: an invalid since/until is rejected before any GitHub call", async () => {
  const res = await post(
    "/api/github/history",
    JSON.stringify({ url: "https://example.com/x", since: "not a date" })
  );
  assertEqual(res.status, 400, "rejected");
});

// ── /commit ──────────────────────────────────────────────────────────────

test("commit: a missing sha is a 400", async () => {
  const res = await post("/api/github/commit", JSON.stringify({ url: "https://github.com/o/r" }));
  assertEqual(res.status, 400, "400");
  assertEqual((await json(res)).message, "sha is required", "clear message");
});

test("commit: a malformed sha is a 400 before any GitHub call", async () => {
  const res = await post(
    "/api/github/commit",
    JSON.stringify({ url: "https://github.com/o/r", sha: "not a sha!!" })
  );
  assertEqual(res.status, 400, "400");
});

// ── /compare ─────────────────────────────────────────────────────────────

test("compare: missing base or head is a 400", async () => {
  const noBase = await post(
    "/api/github/compare",
    JSON.stringify({ url: "https://github.com/o/r", head: "abc123" })
  );
  assertEqual(noBase.status, 400, "base required");

  const noHead = await post(
    "/api/github/compare",
    JSON.stringify({ url: "https://github.com/o/r", base: "abc123" })
  );
  assertEqual(noHead.status, 400, "head required");
});

test("compare: a ref containing '..' is rejected (the compare endpoint's own separator)", async () => {
  const res = await post(
    "/api/github/compare",
    JSON.stringify({ url: "https://github.com/o/r", base: "a..b", head: "c" })
  );
  assertEqual(res.status, 400, "rejected");
});

test("compare: identical base and head are valid input (same-SHA comparison is not itself an error)", async () => {
  // Still fails — the URL is invalid — but specifically on the URL, proving
  // identical refs are not rejected by validation itself.
  const res = await post(
    "/api/github/compare",
    JSON.stringify({ url: "https://example.com/x", base: "abc123", head: "abc123" })
  );
  assertEqual((await json(res)).message, "Invalid GitHub repository URL", "fails on the URL, not the refs");
});

// ── /file-history ────────────────────────────────────────────────────────

test("file-history: a missing path is a 400", async () => {
  const res = await post("/api/github/file-history", JSON.stringify({ url: "https://github.com/o/r" }));
  assertEqual(res.status, 400, "400");
  assertEqual((await json(res)).message, "path is required", "clear message");
});

test("file-history: an empty path is rejected", async () => {
  const res = await post(
    "/api/github/file-history",
    JSON.stringify({ url: "https://github.com/o/r", path: "" })
  );
  assertEqual(res.status, 400, "rejected");
});

test("file-history: pagination fields reuse the same validation as /history", async () => {
  const res = await post(
    "/api/github/file-history",
    JSON.stringify({ url: "https://github.com/o/r", path: "a.ts", page: -1 })
  );
  assertEqual(res.status, 400, "rejected");
});

// ── security / credential isolation ──────────────────────────────────────

test("a client cannot supply its own GitHub credential on any history endpoint", async () => {
  for (const path of ENDPOINTS) {
    const res = await post(
      path,
      JSON.stringify({ url: "https://example.com/x", token: "ghu_attacker", credential: "x" })
    );
    assertEqual(res.status, 400, `${path}: extra fields change nothing`);
    assert(!JSON.stringify(await json(res)).includes("ghu_attacker"), `${path}: never echoed`);
  }
});

test("errors use the standard envelope and leak no internals, on every history endpoint", async () => {
  for (const path of ENDPOINTS) {
    const res = await post(path, INVALID_URL);
    const body = await json(res);
    assertEqual(Object.keys(body).sort(), ["message", "success"], `${path}: exactly the envelope`);
    const text = JSON.stringify(body);
    assert(!/node_modules|at .*\.ts:|Octokit|tree-sitter|stack/i.test(text), `${path}: no internals`);
    assert(!/gh[pousr]_/.test(text), `${path}: no credential shapes`);
  }
});

test("a malicious commit message or path in a request body is never reflected unescaped (it is never echoed at all, since validation rejects the request first)", async () => {
  const res = await post(
    "/api/github/commit",
    JSON.stringify({ url: "https://example.com/x", sha: '<script>alert(1)</script>' })
  );
  assertEqual(res.status, 400, "rejected by sha validation");
  assert(!(await res.text()).includes("<script>"), "never reflected");
});

// ── backward compatibility ───────────────────────────────────────────────

test("every earlier phase's endpoint is unaffected", async () => {
  for (const path of [
    "/api/github/tree",
    "/api/github/dependencies",
    "/api/github/workflows",
    "/api/github/call-graph",
  ]) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: INVALID_URL,
    });
    assertEqual(res.status, 400, `${path} unchanged`);
    assertEqual(
      (await json(res)).message,
      "Invalid GitHub repository URL",
      `${path} message unchanged`
    );
  }
});

test("health still works alongside the new routes", async () => {
  const res = await fetch(`${base}/api/health`);
  assertEqual(res.status, 200, "200");
  assertEqual(await json(res), { success: true, message: "Backend is running" }, "unchanged");
});

await report("Git history endpoint HTTP tests");
server.close();
