/**
 * Tests for the GitHub service's error mapping and tree normalization.
 *
 * These cover the failure paths that cannot be provoked against the live API
 * without abusing it (rate limits, 5xx) by feeding the mapper the same error
 * shapes Octokit raises.
 *
 * Run with:  npx tsx src/services/githubService.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { AppError } from "../utils/appError.js";
import { normalizeTreeEntries, toAppError } from "./githubService.js";

/** Mimics the shape Octokit throws: an Error carrying an HTTP status. */
function octokitError(
  status: number,
  options: { message?: string; headers?: Record<string, unknown> } = {}
): Error & { status: number; response?: { headers: Record<string, unknown> } } {
  const error = new Error(options.message ?? `HTTP ${status}`) as Error & {
    status: number;
    response?: { headers: Record<string, unknown> };
  };
  error.status = status;
  if (options.headers !== undefined) {
    error.response = { headers: options.headers };
  }
  return error;
}

test("401 becomes a clean 401 authentication error", () => {
  const mapped = toAppError(octokitError(401));
  assertEqual(mapped.statusCode, 401, "status");
  assert(
    mapped.message.toLowerCase().includes("authentication"),
    "message names the authentication problem"
  );
  assert(
    !mapped.message.toLowerCase().includes("rate limit"),
    "no longer conflated with rate limiting"
  );
});

test("429 becomes a 429 with a rate-limit message", () => {
  const mapped = toAppError(octokitError(429));
  assertEqual(mapped.statusCode, 429, "status");
  assert(mapped.message.includes("rate limit"), "mentions the rate limit");
});

test("403 is a permission error, not a rate-limit error", () => {
  // Regression: every 403 used to be reported as a rate limit, so a token
  // lacking a scope told the user to wait for a limit that never clears.
  const mapped = toAppError(octokitError(403, { message: "Resource not accessible by integration" }));
  assertEqual(mapped.statusCode, 403, "status");
  assert(!mapped.message.includes("rate limit"), "not a rate-limit message");
  assert(mapped.message.toLowerCase().includes("restricted"), "explains the restriction");
});

test("403 IS treated as rate limiting when GitHub says so", () => {
  // GitHub answers an exhausted primary rate limit with 403, not 429.
  const byHeader = toAppError(octokitError(403, { headers: { "x-ratelimit-remaining": "0" } }));
  assertEqual(byHeader.statusCode, 429, "header-detected rate limit");
  assert(byHeader.message.includes("rate limit"), "rate-limit message");

  const byRetryAfter = toAppError(octokitError(403, { headers: { "retry-after": "60" } }));
  assertEqual(byRetryAfter.statusCode, 429, "retry-after detected");

  const byMessage = toAppError(octokitError(403, { message: "API rate limit exceeded for 1.2.3.4" }));
  assertEqual(byMessage.statusCode, 429, "message-detected rate limit");

  const secondary = toAppError(octokitError(403, { message: "You have triggered an abuse detection mechanism" }));
  assertEqual(secondary.statusCode, 429, "secondary rate limit detected");
});

test("403 with rate-limit headers still present but not exhausted stays a 403", () => {
  const mapped = toAppError(octokitError(403, { headers: { "x-ratelimit-remaining": "42" } }));
  assertEqual(mapped.statusCode, 403, "quota remains, so it is a permission problem");
});

test("404 stays a privacy-preserving 'not found'", () => {
  // A private repository the caller cannot see returns 404 from GitHub. The
  // message must not hint that the repository exists.
  const mapped = toAppError(octokitError(404));
  assertEqual(mapped.statusCode, 404, "status");
  assertEqual(mapped.message, "GitHub repository not found", "message");
  assert(!/private|permission|access/i.test(mapped.message), "no existence hint");
});

test("upstream GitHub failures become a 502", () => {
  for (const status of [500, 502, 503, 504]) {
    const mapped = toAppError(octokitError(status));
    assertEqual(mapped.statusCode, 502, `status for ${status}`);
    assertEqual(
      mapped.message,
      "Failed to fetch GitHub repository",
      `message for ${status}`
    );
  }
});

test("unrecognised failures also become a 502 and never leak details", () => {
  for (const error of [
    new Error("socket hang up"),
    "a bare string",
    null,
    undefined,
    { weird: true },
  ]) {
    const mapped = toAppError(error);
    assert(mapped instanceof AppError, "an AppError is produced");
    assertEqual(mapped.statusCode, 502, "status");
    assertEqual(
      mapped.message,
      "Failed to fetch GitHub repository",
      "generic message"
    );
  }
});

test("mapped errors never carry the original message or a stack of internals", () => {
  const original = octokitError(500);
  original.message = "secret-internal-detail: token=abc123";
  const mapped = toAppError(original);
  assert(
    !mapped.message.includes("secret-internal-detail"),
    "internal detail is not exposed"
  );
  assert(!mapped.message.includes("token"), "no token leaks");
});

test("blob becomes file and tree becomes directory", () => {
  assertEqual(
    normalizeTreeEntries([
      { path: "README.md", type: "blob" },
      { path: "src", type: "tree" },
    ]),
    [
      { path: "README.md", type: "file" },
      { path: "src", type: "directory" },
    ],
    "normalized"
  );
});

test("submodule entries (type 'commit') are dropped, not mislabelled", () => {
  const result = normalizeTreeEntries([
    { path: "README.md", type: "blob" },
    { path: "vendor/libfoo", type: "commit" },
    { path: "src", type: "tree" },
  ]);
  assertEqual(result.length, 2, "submodule omitted");
  assert(
    !result.some((n) => n.path === "vendor/libfoo"),
    "submodule path absent"
  );
  assert(
    result.every((n) => n.type === "file" || n.type === "directory"),
    "only file/directory types survive"
  );
});

test("entries with a missing or empty path are skipped", () => {
  const result = normalizeTreeEntries([
    { type: "blob" },
    { path: "", type: "blob" },
    { path: "ok.txt", type: "blob" },
  ]);
  assertEqual(result, [{ path: "ok.txt", type: "file" }], "only valid entries");
});

test("unknown entry types are skipped rather than guessed at", () => {
  assertEqual(
    normalizeTreeEntries([
      { path: "a", type: "something-new" },
      { path: "b", type: "blob" },
    ]),
    [{ path: "b", type: "file" }],
    "unknown type dropped"
  );
});

test("normalization only ever emits path and type", () => {
  // Extra Octokit fields are deliberately present on the input here.
  const entries: Array<{ path?: string; type?: string }> = [
    { path: "a.txt", type: "blob", sha: "deadbeef", size: 12, url: "https://x" },
  ] as unknown as Array<{ path?: string; type?: string }>;
  const result = normalizeTreeEntries(entries);
  assertEqual(
    Object.keys(result[0]).sort(),
    ["path", "type"],
    "no Octokit fields leak through"
  );
});

test("an empty tree normalizes to an empty array", () => {
  assertEqual(normalizeTreeEntries([]), [], "empty");
});

test("the complete GitHub status matrix maps to documented semantics", () => {
  // Every status the QA matrix lists, and what DriftWatch reports for it.
  const matrix: Array<[number, number, string]> = [
    [301, 502, "redirects are followed by Octokit; a surfaced one is upstream trouble"],
    [302, 502, "same"],
    [304, 502, "not-modified is unexpected here"],
    [400, 502, "a bad request to GitHub is our problem, reported as upstream failure"],
    [401, 401, "authentication"],
    [404, 404, "privacy-preserving not found"],
    [409, 502, "conflict is only special-cased for the empty-repository tree call"],
    [422, 502, "unprocessable"],
    [429, 429, "rate limit"],
    [500, 502, "upstream"],
    [502, 502, "upstream"],
    [503, 502, "upstream"],
    [504, 502, "upstream"],
  ];

  for (const [status, expected, why] of matrix) {
    const mapped = toAppError(octokitError(status));
    assertEqual(mapped.statusCode, expected, `${status} -> ${expected} (${why})`);
  }
});

test("no mapped status ever exposes the upstream status or body", () => {
  for (const status of [301, 400, 401, 403, 404, 409, 422, 429, 500, 503]) {
    const original = octokitError(status, {
      message: `Upstream said: secret-detail token=ghp_abcdefghijklmnop at https://api.github.com/x`,
    });
    const mapped = toAppError(original);
    assert(!mapped.message.includes("secret-detail"), `${status}: no upstream detail`);
    assert(!mapped.message.includes("ghp_"), `${status}: no credential shape`);
    assert(!mapped.message.includes("api.github.com"), `${status}: no upstream URL`);
    assert(mapped.message.length < 120, `${status}: message stays short and human`);
  }
});

test("every mapped error carries one of the documented statuses", () => {
  const allowed = new Set([401, 403, 404, 429, 502]);
  for (let status = 400; status <= 599; status++) {
    const mapped = toAppError(octokitError(status));
    assert(
      allowed.has(mapped.statusCode),
      `${status} mapped to an undocumented ${mapped.statusCode}`
    );
  }
});

await report("githubService error mapping / normalization tests");
