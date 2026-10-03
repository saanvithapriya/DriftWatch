/**
 * HTTP hardening tests: prototype pollution, content types, oversized bodies,
 * method handling, CORS, hostile cookies and open-redirect attempts.
 *
 * The real Express app is booted in-process; no network access is involved.
 *
 * Run with:  npx tsx src/controllers/httpHardening.test.ts
 */
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { assert, assertEqual, report, test } from "../testHarness.js";

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

const ENDPOINTS = ["/api/github/tree", "/api/github/dependencies"] as const;

async function post(path: string, body: string, contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers["content-type"] = contentType;
  return fetch(`${base}${path}`, { method: "POST", headers, body });
}

async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

// ── methods ──────────────────────────────────────────────────────────────

test("only GET is served on /api/health; other methods are refused", async () => {
  assertEqual((await fetch(`${base}/api/health`)).status, 200, "GET");
  assertEqual((await fetch(`${base}/api/health`, { method: "HEAD" })).status, 200, "HEAD");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await fetch(`${base}/api/health`, { method });
    assertEqual(res.status, 404, `${method} refused`);
  }
});

test("CORS preflight is answered without exposing the endpoint to other methods", async () => {
  const res = await fetch(`${base}/api/github/tree`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
    },
  });
  assert(res.status === 204 || res.status === 200, `preflight answered, got ${res.status}`);
});

// ── prototype pollution ──────────────────────────────────────────────────

test("prototype-pollution shaped bodies neither pollute nor crash", async () => {
  const bodies = [
    '{"url":"https://example.com/x","__proto__":{"polluted":true}}',
    '{"__proto__":{"isAdmin":true},"url":"https://example.com/x"}',
    '{"constructor":{"prototype":{"hacked":true}},"url":"https://example.com/x"}',
    '{"url":{"__proto__":{"toString":"evil"}}}',
  ];
  for (const body of bodies) {
    for (const endpoint of ENDPOINTS) {
      const res = await post(endpoint, body, "application/json");
      assert(res.status >= 400 && res.status < 500, `client error for ${body.slice(0, 30)}`);
    }
  }

  const probe = {} as Record<string, unknown>;
  assertEqual(probe.polluted, undefined, "Object.prototype.polluted untouched");
  assertEqual(probe.isAdmin, undefined, "Object.prototype.isAdmin untouched");
  assertEqual(probe.hacked, undefined, "Object.prototype.hacked untouched");
});

// ── bodies and content types ─────────────────────────────────────────────

test("every malformed body shape is a 4xx, never a 500", async () => {
  const bodies = [
    ["{}", "application/json"],
    ['{"url":""}', "application/json"],
    ['{"url":null}', "application/json"],
    ['{"url":123}', "application/json"],
    ['{"url":[]}', "application/json"],
    ['{"url":{}}', "application/json"],
    ['{"url":true}', "application/json"],
    ["[1,2,3]", "application/json"],
    ["", "application/json"],
    ['{"url": ', "application/json"],
    ['{"url":"https://example.com/x"}', "text/plain"],
    ['{"url":"https://example.com/x"}', undefined],
  ] as const;

  for (const [body, contentType] of bodies) {
    for (const endpoint of ENDPOINTS) {
      const res = await post(endpoint, body, contentType);
      assert(
        res.status >= 400 && res.status < 500,
        `${endpoint} ${JSON.stringify(body)} (${contentType ?? "no type"}) -> ${res.status}`
      );
      const payload = await json(res);
      assertEqual(payload.success, false, "error envelope");
      assert(typeof payload.message === "string", "has a message");
    }
  }
});

test("unexpected extra properties are ignored, not trusted", async () => {
  const res = await post(
    "/api/github/tree",
    JSON.stringify({
      url: "https://example.com/x",
      token: "ghu_attacker",
      credential: { token: "ghu_attacker" },
      admin: true,
    }),
    "application/json"
  );
  assertEqual(res.status, 400, "still just an invalid URL");
  assert(!JSON.stringify(await json(res)).includes("ghu_attacker"), "never echoed");
});

test("an oversized body is refused with a clear 413", async () => {
  const body = JSON.stringify({ url: "https://github.com/a/b", pad: "x".repeat(2 * 1024 * 1024) });
  const res = await post("/api/github/tree", body, "application/json");
  assertEqual(res.status, 413, "413");
  assertEqual(
    (await json(res)).message,
    "Request body is too large",
    "message explains the problem"
  );
});

// ── error envelope ───────────────────────────────────────────────────────

test("no error response leaks internals", async () => {
  const responses = [
    await post("/api/github/tree", '{"url":"https://example.com/x"}', "application/json"),
    await post("/api/github/tree", '{"url": ', "application/json"),
    await fetch(`${base}/api/does-not-exist`),
  ];
  for (const res of responses) {
    const text = await res.text();
    assert(!/node_modules|at .*\.ts:\d|Octokit|Error:|stack/i.test(text), `no internals: ${text}`);
    assert(!/gh[pousr]_/.test(text), "no credential shapes");
  }
});

// ── CORS ─────────────────────────────────────────────────────────────────

test("CORS never answers with a wildcard, whatever origin asks", async () => {
  for (const origin of [
    "http://localhost:5173",
    "http://evil.example",
    "null",
    "http://localhost:5174",
    "https://localhost:5173",
  ]) {
    const res = await fetch(`${base}/api/health`, { headers: { origin } });
    const allow = res.headers.get("access-control-allow-origin");
    assertEqual(allow, "http://localhost:5173", `configured origin only, asked by ${origin}`);
    assert(allow !== "*", "never a wildcard alongside credentials");
  }
});

test("credentials are enabled for the configured origin", async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { origin: "http://localhost:5173" },
  });
  assertEqual(res.headers.get("access-control-allow-credentials"), "true", "credentials");
});

// ── hostile cookies ──────────────────────────────────────────────────────

test("hostile session cookies are treated as signed out, never crash", async () => {
  const cookies = [
    "driftwatch_session=",
    "driftwatch_session=../../etc/passwd",
    `driftwatch_session=${"A".repeat(5000)}`,
    "driftwatch_session=%00%01%02",
    'driftwatch_session={"a":1}',
    "driftwatch_session=a; driftwatch_session=b",
    "driftwatch_session=<script>alert(1)</script>",
    "driftwatch_session=__proto__",
  ];
  for (const cookie of cookies) {
    const res = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assertEqual(res.status, 200, `handled: ${cookie.slice(0, 30)}`);
    assertEqual((await json(res)).data.user, null, "signed out");
  }
});

test("a random session id never authenticates", async () => {
  for (let i = 0; i < 20; i++) {
    const id = Buffer.from(String(Math.random())).toString("base64url");
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { cookie: `driftwatch_session=${id}` },
    });
    assertEqual((await json(res)).data.user, null, "not authenticated");
  }
});

// ── redirects ────────────────────────────────────────────────────────────

test("the auth callback only ever redirects to the configured frontend", async () => {
  const attempts = [
    "?code=x&state=y&redirect=https://evil.com",
    "?code=x&state=y&redirect_uri=//evil.com",
    "?code=x&state=y&returnTo=http://evil.com",
    "?code=x&state=y&next=https://github.com.evil.com",
    "?code=x&state=y&redirect=%2F%2Fevil.com",
    "?code=x&state=y",
  ];
  for (const query of attempts) {
    const res = await fetch(`${base}/api/auth/github/callback${query}`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    assert(
      location.startsWith("http://localhost:5173"),
      `redirect stays on the frontend origin: ${location}`
    );
    assert(!/evil\.com/.test(location), `no attacker host: ${location}`);
  }
});

await report("HTTP hardening tests");
server.close();
