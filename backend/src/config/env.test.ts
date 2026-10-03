/**
 * Tests for environment configuration validation.
 *
 * A bad value must be reported at startup, naming the variable, rather than
 * surfacing later as a RangeError from listen() or a 500 from a request
 * handler.
 *
 * Run with:  npx tsx src/config/env.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { readFrontendUrl, readPort } from "./env.js";

function expectThrows(run: () => unknown, mustMention: string, label: string): void {
  let message: string | null = null;
  try {
    run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== null, `${label}: threw`);
  assert(
    (message ?? "").includes(mustMention),
    `${label}: message names ${mustMention}, got ${message}`
  );
}

// ── PORT ─────────────────────────────────────────────────────────────────

test("a missing or blank PORT falls back to the default", () => {
  assertEqual(readPort(undefined), 5000, "unset");
  assertEqual(readPort(""), 5000, "empty");
  assertEqual(readPort("   "), 5000, "whitespace");
});

test("a valid PORT is used", () => {
  assertEqual(readPort("3000"), 3000, "3000");
  assertEqual(readPort("1"), 1, "lowest");
  assertEqual(readPort("65535"), 65535, "highest");
});

test("an out-of-range or non-integer PORT fails fast and names the variable", () => {
  // Regression: these used to pass through and crash inside listen() with a
  // bare RangeError, or silently become a nonsense port.
  for (const raw of ["-1", "0", "65536", "99999", "3.7", "abc", "12abc", "NaN", "Infinity"]) {
    expectThrows(() => readPort(raw), "PORT", `rejected ${raw}`);
  }
});

test("the PORT error quotes the offending value", () => {
  let message = "";
  try {
    readPort("-1");
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assert(message.includes('"-1"'), `value quoted: ${message}`);
});

// ── FRONTEND_URL ─────────────────────────────────────────────────────────

test("a missing or blank FRONTEND_URL falls back to the default", () => {
  assertEqual(readFrontendUrl(undefined), "http://localhost:5173", "unset");
  assertEqual(readFrontendUrl(""), "http://localhost:5173", "empty");
});

test("a valid FRONTEND_URL is normalized to its origin", () => {
  assertEqual(readFrontendUrl("http://localhost:5173"), "http://localhost:5173", "plain");
  assertEqual(readFrontendUrl("http://localhost:5173/"), "http://localhost:5173", "trailing slash removed");
  assertEqual(readFrontendUrl("https://app.example.com"), "https://app.example.com", "https");
  assertEqual(
    readFrontendUrl("https://app.example.com/some/path"),
    "https://app.example.com",
    "path dropped so CORS compares origins exactly"
  );
});

test("a malformed FRONTEND_URL fails fast instead of 500ing later", () => {
  // Regression: these reached `new URL()` inside the auth callback and became
  // an unexplained 500 at request time.
  for (const raw of ["not a url", "localhost:5173", "http://", "//example.com", "   /path"]) {
    expectThrows(() => readFrontendUrl(raw), "FRONTEND_URL", `rejected ${JSON.stringify(raw)}`);
  }
});

test("a non-http scheme is rejected", () => {
  for (const raw of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "data:text/html,x"]) {
    expectThrows(() => readFrontendUrl(raw), "FRONTEND_URL", `rejected ${raw}`);
  }
});

test("a validated FRONTEND_URL always survives URL construction", () => {
  // This is what the auth callback does with it.
  for (const raw of ["http://localhost:5173", "https://app.example.com/", "http://127.0.0.1:8080"]) {
    const value = readFrontendUrl(raw);
    const url = new URL(value);
    url.searchParams.set("auth", "connected");
    assert(url.toString().startsWith(value), `usable for redirects: ${url.toString()}`);
  }
});

await report("environment configuration tests");
