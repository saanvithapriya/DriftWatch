/**
 * Tests for the GitHub repository URL parser.
 *
 * Run with:  npx tsx src/utils/githubUrl.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { AppError } from "./appError.js";
import {
  parseGithubRepositoryUrl,
  parseGithubRepositoryUrlOrThrow,
} from "./githubUrl.js";

const ACCEPTED: Array<[string, string, string]> = [
  ["https://github.com/octocat/Hello-World", "octocat", "Hello-World"],
  ["https://github.com/octocat/Hello-World/", "octocat", "Hello-World"],
  ["https://github.com/octocat/Hello-World.git", "octocat", "Hello-World"],
  ["http://github.com/octocat/Hello-World", "octocat", "Hello-World"],
  ["https://www.github.com/octocat/Hello-World", "octocat", "Hello-World"],
  ["github.com/octocat/Hello-World", "octocat", "Hello-World"],
  ["https://GitHub.com/octocat/Hello-World", "octocat", "Hello-World"],
  ["https://github.com/octocat/Hello-World?tab=readme", "octocat", "Hello-World"],
  ["https://github.com/octocat/Hello-World#readme", "octocat", "Hello-World"],
  ["  https://github.com/octocat/Hello-World  ", "octocat", "Hello-World"],
  ["https://github.com/a/b.c_d-e", "a", "b.c_d-e"],
];

const REJECTED: string[] = [
  // Wrong host
  "https://google.com/octocat/Hello-World",
  "https://gitlab.com/octocat/Hello-World",
  "https://bitbucket.org/octocat/Hello-World",
  "https://github.com.evil.com/a/b",
  "https://evil.com/github.com/a/b",
  "https://notgithub.com/a/b",
  // Missing segments
  "https://github.com/",
  "https://github.com/octocat",
  "https://github.com//Hello-World",
  "https://github.com",
  // Too many segments
  "https://github.com/octocat/Hello-World/tree/main",
  "https://github.com/octocat/Hello-World/blob/main/README.md",
  "https://github.com/octocat/Hello-World/issues",
  // Malformed
  "not a url",
  ":",
  "::",
  "https://",
  "https://github",
  "",
  "   ",
  // Non-HTTP schemes must not slip through
  "ftp://github.com/a/b",
  "file:///etc/passwd",
  "javascript:alert(1)",
  // Embedded credentials: host-confusion phishing shape
  "https://evil.com@github.com/octocat/Hello-World",
  "https://user:pass@github.com/octocat/Hello-World",
  "https://github.com@evil.com/octocat/Hello-World",
  // Non-default ports are not the public GitHub service
  "https://github.com:8080/octocat/Hello-World",
  "https://github.com:22/octocat/Hello-World",
  "http://github.com:3000/octocat/Hello-World",
  // SSRF-style targets
  "http://localhost:5000",
  "http://127.0.0.1",
  "http://192.168.1.1",
  "http://169.254.169.254/latest/meta-data",
  "http://[::1]:5000",
  "https://example.com",
];

test("accepted URL forms parse to the right owner and repository", () => {
  for (const [input, owner, repo] of ACCEPTED) {
    const parsed = parseGithubRepositoryUrl(input);
    assert(parsed !== null, `accepted: ${input}`);
    assertEqual(parsed, { owner, repo }, `parsed: ${input}`);
  }
});

test("rejected URL forms all return null", () => {
  for (const input of REJECTED) {
    assertEqual(parseGithubRepositoryUrl(input), null, `rejected: ${input}`);
  }
});

test("only github.com hosts are accepted (no SSRF to other hosts)", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "metadata.google.internal",
    "example.com",
  ]) {
    assertEqual(
      parseGithubRepositoryUrl(`http://${host}/owner/repo`),
      null,
      `host rejected: ${host}`
    );
  }
});

test("parsing is deterministic", () => {
  const a = parseGithubRepositoryUrl("https://github.com/octocat/Hello-World");
  const b = parseGithubRepositoryUrl("https://github.com/octocat/Hello-World");
  assertEqual(a, b, "same input, same output");
});

test("the throwing wrapper raises a 400 AppError for bad input", () => {
  for (const input of ["https://example.com/x", "", "not a url"]) {
    let caught: unknown;
    try {
      parseGithubRepositoryUrlOrThrow(input);
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof AppError, `AppError thrown for ${input}`);
    assertEqual((caught as AppError).statusCode, 400, "status is 400");
    assertEqual(
      (caught as AppError).message,
      "Invalid GitHub repository URL",
      "message is the documented one"
    );
  }
});

test("the throwing wrapper rejects non-string input", () => {
  for (const input of [undefined, null, 123, {}, [], true]) {
    let threw = false;
    try {
      parseGithubRepositoryUrlOrThrow(input);
    } catch {
      threw = true;
    }
    assert(threw, `rejected: ${JSON.stringify(input) ?? "undefined"}`);
  }
});

test("the throwing wrapper returns owner and repo for valid input", () => {
  assertEqual(
    parseGithubRepositoryUrlOrThrow("https://github.com/octocat/Hello-World"),
    { owner: "octocat", repo: "Hello-World" },
    "parsed"
  );
});

test("a URL carrying credentials is rejected even when the host is github.com", () => {
  // Regression: `https://evil.com@github.com/o/r` parsed cleanly because only
  // the hostname was checked. The host is legitimate, but the credential form
  // is a phishing shape and never appears in a real repository URL.
  for (const input of [
    "https://evil.com@github.com/octocat/Hello-World",
    "https://user:pass@github.com/octocat/Hello-World",
    "https://:pass@github.com/octocat/Hello-World",
  ]) {
    assertEqual(parseGithubRepositoryUrl(input), null, `rejected: ${input}`);
  }
});

test("the default port is still accepted, other ports are not", () => {
  assertEqual(
    parseGithubRepositoryUrl("https://github.com:443/octocat/Hello-World"),
    { owner: "octocat", repo: "Hello-World" },
    "explicit default https port is the same service"
  );
  assertEqual(
    parseGithubRepositoryUrl("http://github.com:80/octocat/Hello-World"),
    { owner: "octocat", repo: "Hello-World" },
    "explicit default http port"
  );
  for (const input of [
    "https://github.com:8080/octocat/Hello-World",
    "https://github.com:22/octocat/Hello-World",
  ]) {
    assertEqual(parseGithubRepositoryUrl(input), null, `rejected: ${input}`);
  }
});

test("path traversal inside the URL resolves per the URL spec, not into extra segments", () => {
  // `https://github.com/../../etc/passwd` IS `https://github.com/etc/passwd`
  // by URL semantics, so it parses as that owner/repo rather than escaping.
  assertEqual(
    parseGithubRepositoryUrl("https://github.com/../../etc/passwd"),
    { owner: "etc", repo: "passwd" },
    "normalized by the URL parser"
  );
  assertEqual(
    parseGithubRepositoryUrl("https://github.com/octocat/repo/../../evil"),
    null,
    "still only two segments are accepted"
  );
});

await report("parseGithubRepositoryUrl() tests");
