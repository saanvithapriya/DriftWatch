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
function octokitError(status: number): Error & { status: number } {
  const error = new Error(`HTTP ${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

test("a 404 becomes a clean 404 'repository not found'", () => {
  const mapped = toAppError(octokitError(404));
  assertEqual(mapped.statusCode, 404, "status");
  assertEqual(mapped.message, "GitHub repository not found", "message");
});

test("rate limiting (403 and 429) becomes a 429 with a rate-limit message", () => {
  for (const status of [403, 429]) {
    const mapped = toAppError(octokitError(status));
    assertEqual(mapped.statusCode, 429, `status for ${status}`);
    assert(
      mapped.message.includes("rate limit"),
      `message mentions the rate limit for ${status}`
    );
  }
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

report("githubService error mapping / normalization tests");
