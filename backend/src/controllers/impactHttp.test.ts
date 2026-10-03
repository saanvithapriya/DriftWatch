/**
 * HTTP-level tests specific to POST /api/github/impact (shared validation —
 * URL, JSON, method, credential isolation — is covered in
 * historyHttp.test.ts, which includes this route in its shared sweep).
 *
 * Run with:  npx tsx src/controllers/impactHttp.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;
const endpoint = `${base}/api/github/impact`;

async function post(body: string) {
  return fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

test("missing base or head is a 400", async () => {
  const noBase = await post(JSON.stringify({ url: "https://github.com/o/r", head: "abc123" }));
  assertEqual(noBase.status, 400, "base required");

  const noHead = await post(JSON.stringify({ url: "https://github.com/o/r", base: "abc123" }));
  assertEqual(noHead.status, 400, "head required");
});

test("a base or head containing '..' is rejected", async () => {
  const res = await post(
    JSON.stringify({ url: "https://github.com/o/r", base: "a...b", head: "c" })
  );
  assertEqual(res.status, 400, "rejected");
});

test("maxDepth is accepted when omitted — it is optional, not required", async () => {
  // Fails on the URL (never reaches GitHub), proving omitted maxDepth is not
  // itself rejected.
  const res = await post(
    JSON.stringify({ url: "https://example.com/x", base: "a", head: "b" })
  );
  assertEqual((await json(res)).message, "Invalid GitHub repository URL", "fails on the URL only");
});

test("a non-numeric maxDepth does not crash — it falls back rather than erroring", async () => {
  const res = await post(
    JSON.stringify({ url: "https://example.com/x", base: "a", head: "b", maxDepth: "deep" })
  );
  // Still fails on the URL (invalid maxDepth is clamped, not rejected) —
  // confirms the request is processed rather than 500ing.
  assertEqual(res.status, 400, "controlled 400, not a 500");
  assertEqual((await json(res)).message, "Invalid GitHub repository URL", "reached URL validation");
});

test("errors never leak repository source, dependency internals or stack traces", async () => {
  const res = await post(JSON.stringify({ url: "https://example.com/x", base: "a", head: "b" }));
  const text = JSON.stringify(await json(res));
  assert(!/node_modules|at .*\.ts:|tree-sitter|TreeSitter|stack/i.test(text), "no internals");
});

test("only POST is accepted", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    assertEqual((await fetch(endpoint, { method })).status, 404, `${method} refused`);
  }
});

await report("Impact endpoint HTTP tests");
server.close();
