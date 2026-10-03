/**
 * Tests for Phase 7's pure history mapping and validation logic — everything
 * that does not require a live GitHub call. The network-touching paths
 * (fetchCommitHistory, fetchCommitDetail, compareCommits, fetchFileHistory,
 * fetchHistoryStats) are exercised at the HTTP layer in historyHttp.test.ts,
 * via inputs that are rejected before any GitHub request is made — the same
 * pattern every earlier phase's HTTP test suite uses.
 *
 * Run with:  npx tsx src/services/historyService.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import {
  capFiles,
  computeFileEvolutionStats,
  hasNextPage,
  toChangedFile,
  toCommitAuthor,
  toCommitSummary,
  validateGitRef,
  validateHistoryQuery,
  type RawCommit,
  type RawFile,
} from "./historyService.js";

// ── validateGitRef ───────────────────────────────────────────────────────

test("a well-formed sha is accepted", () => {
  assertEqual(validateGitRef("7fd1a60b01f91b314f59955a4e4d4e80d8edf11d", "sha"), "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d", "accepted");
});

test("a branch-name-shaped ref is accepted", () => {
  assertEqual(validateGitRef("feature/my-branch", "head"), "feature/my-branch", "accepted");
});

test("missing, empty, non-string or over-long refs are rejected", () => {
  for (const value of [undefined, null, "", 123, {}, [], "x".repeat(250)]) {
    let threw = false;
    try {
      validateGitRef(value, "sha");
    } catch {
      threw = true;
    }
    assert(threw, `rejected: ${JSON.stringify(value)}`);
  }
});

test("a ref containing '..' is rejected — it is the compare separator, never a real ref", () => {
  for (const value of ["a..b", "a...b", "..", "a/../b"]) {
    let threw = false;
    try {
      validateGitRef(value, "base");
    } catch {
      threw = true;
    }
    assert(threw, `rejected: ${value}`);
  }
});

test("whitespace and shell-metacharacter refs are rejected", () => {
  for (const value of ["sha with spaces", "sha;rm -rf /", "sha`whoami`", "sha$(whoami)", "sha\nnewline"]) {
    let threw = false;
    try {
      validateGitRef(value, "base");
    } catch {
      threw = true;
    }
    assert(threw, `rejected: ${JSON.stringify(value)}`);
  }
});

// ── validateHistoryQuery ─────────────────────────────────────────────────

test("defaults apply when nothing is supplied", () => {
  const q = validateHistoryQuery({});
  assertEqual(q.page, 1, "default page");
  assertEqual(q.perPage, 30, "default perPage");
  assertEqual(q.author, undefined, "no author filter");
});

test("perPage is clamped to the configured ceiling, never silently ignored", () => {
  const q = validateHistoryQuery({ perPage: 99999 });
  assert(q.perPage <= 100, `clamped, got ${q.perPage}`);
});

test("a non-positive-integer page or perPage is rejected", () => {
  for (const page of [0, -1, 1.5, "two", null]) {
    let threw = false;
    try {
      validateHistoryQuery({ page });
    } catch {
      threw = true;
    }
    assert(threw, `rejected page: ${JSON.stringify(page)}`);
  }
});

test("an invalid since/until date is rejected", () => {
  let threw = false;
  try {
    validateHistoryQuery({ since: "not a date" });
  } catch {
    threw = true;
  }
  assert(threw, "rejected");
});

test("a valid ISO date passes through", () => {
  const q = validateHistoryQuery({ since: "2024-01-01T00:00:00Z" });
  assertEqual(q.since, "2024-01-01T00:00:00Z", "kept");
});

test("an oversized author or path filter is rejected", () => {
  let threw = false;
  try {
    validateHistoryQuery({ author: "x".repeat(200) });
  } catch {
    threw = true;
  }
  assert(threw, "rejected");
});

// ── toCommitAuthor / toCommitSummary ────────────────────────────────────

function rawCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    html_url: "https://github.com/o/r/commit/7fd1a60",
    commit: {
      message: "fix: a bug",
      author: { name: "Ada", email: "ada@example.com", date: "2024-01-01T00:00:00Z" },
      committer: { name: "Ada", email: "ada@example.com", date: "2024-01-01T00:00:00Z" },
    },
    author: { login: "ada", avatar_url: "https://avatars.example.com/ada" },
    committer: { login: "ada", avatar_url: "https://avatars.example.com/ada" },
    ...overrides,
  };
}

test("a commit linked to a GitHub account carries its login and avatar", () => {
  const summary = toCommitSummary(rawCommit());
  assertEqual(summary.author.login, "ada", "login");
  assertEqual(summary.author.avatarUrl, "https://avatars.example.com/ada", "avatar");
  assertEqual(summary.shortSha, "7fd1a60", "7-char short sha");
});

test("a commit not linked to any GitHub account has a null login, not a crash", () => {
  const summary = toCommitSummary(rawCommit({ author: null, committer: null }));
  assertEqual(summary.author.login, null, "no login");
  assertEqual(summary.author.avatarUrl, null, "no avatar");
  // The git identity (name/email) is still present even with no linked account.
  assertEqual(summary.author.name, "Ada", "git identity kept");
});

test("toCommitAuthor never throws on missing identity fields", () => {
  const author = toCommitAuthor(undefined, undefined);
  assertEqual(author, { name: "", email: "", login: null, avatarUrl: null }, "empty but well-formed");
});

// ── toChangedFile / capFiles ─────────────────────────────────────────────

test("an added file", () => {
  const file = toChangedFile({ filename: "new.ts", status: "added", additions: 10, deletions: 0, changes: 10 });
  assertEqual(file.status, "added", "status");
  assertEqual(file.previousPath, null, "no previous path");
});

test("a removed (deleted) file", () => {
  const file = toChangedFile({ filename: "gone.ts", status: "removed", additions: 0, deletions: 40, changes: 40 });
  assertEqual(file.status, "removed", "status");
  assertEqual(file.patchAvailable, false, "no patch field means none available");
});

test("a renamed file carries its previous path", () => {
  const file = toChangedFile({
    filename: "src/new-name.ts",
    status: "renamed",
    previous_filename: "src/old-name.ts",
    additions: 0,
    deletions: 0,
    changes: 0,
  });
  assertEqual(file.previousPath, "src/old-name.ts", "previous path kept");
});

test("a binary file with no patch is reported honestly as patchAvailable: false", () => {
  const file = toChangedFile({ filename: "logo.png", status: "modified", additions: 0, deletions: 0, changes: 0 });
  assertEqual(file.patchAvailable, false, "never assumed");
});

test("a file with a patch is reported as patchAvailable: true, without the patch text", () => {
  const file = toChangedFile({
    filename: "a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: "@@ -1 +1 @@\n-old\n+new",
  });
  assertEqual(file.patchAvailable, true, "flagged");
  assert(!("patch" in file), "the patch text itself is never included in the DTO");
});

test("an unrecognised status string falls back to 'changed' rather than guessing", () => {
  const file = toChangedFile({ filename: "a.ts", status: "some-future-status" });
  assertEqual(file.status, "changed", "safe fallback");
});

test("a very large commit's file list is capped, and the cap is reported", () => {
  const files: RawFile[] = Array.from({ length: 500 }, (_, i) => ({
    filename: `f${i}.ts`,
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
  }));
  const { files: kept, truncated } = capFiles(files);
  assert(kept.length < 500, "capped");
  assertEqual(truncated, true, "flagged, never silent");
});

test("a small commit's file list is never flagged as truncated", () => {
  const files: RawFile[] = [{ filename: "a.ts", status: "modified" }];
  const { truncated } = capFiles(files);
  assertEqual(truncated, false, "not truncated");
});

// ── hasNextPage ──────────────────────────────────────────────────────────

test("a Link header with rel=\"next\" means there is another page", () => {
  assertEqual(
    hasNextPage('<https://api.github.com/x?page=2>; rel="next", <...>; rel="last"'),
    true,
    "next page exists"
  );
});

test("no Link header, or one without rel=\"next\", means no further page", () => {
  assertEqual(hasNextPage(undefined), false, "no header");
  assertEqual(hasNextPage('<...>; rel="prev"'), false, "only prev");
});

// ── computeFileEvolutionStats ────────────────────────────────────────────

test("average changes per commit is null when no commit carries size data", () => {
  const stats = computeFileEvolutionStats([
    {
      sha: "a",
      shortSha: "a",
      date: new Date().toISOString(),
      message: "m",
      author: { name: "A", email: "a@x.com", login: "a", avatarUrl: null },
    },
  ]);
  assertEqual(stats.averageChangesPerCommit, null, "never fabricated");
  assertEqual(stats.totalCommits, 1, "counted");
});

test("active authors are deduplicated by login", () => {
  const entry = (login: string) => ({
    sha: login,
    shortSha: login,
    date: new Date().toISOString(),
    message: "m",
    author: { name: login, email: `${login}@x.com`, login, avatarUrl: null },
  });
  const stats = computeFileEvolutionStats([entry("a"), entry("a"), entry("b")]);
  assertEqual(stats.activeAuthors, 2, "deduplicated");
  assertEqual(stats.totalCommits, 3, "all three counted");
});

test("recentChangeRate reflects commits within the last 90 days, as a 0–1 fraction", () => {
  const recent = new Date().toISOString();
  const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const entry = (date: string, login: string) => ({
    sha: login,
    shortSha: login,
    date,
    message: "m",
    author: { name: login, email: `${login}@x.com`, login, avatarUrl: null },
  });
  const stats = computeFileEvolutionStats([entry(recent, "a"), entry(old, "b")]);
  assertEqual(stats.recentChangeRate, 0.5, "half the commits are recent");
});

test("an empty history has zero, never NaN, aggregate stats", () => {
  const stats = computeFileEvolutionStats([]);
  assertEqual(stats, { totalCommits: 0, activeAuthors: 0, averageChangesPerCommit: null, recentChangeRate: 0 }, "clean zero state");
});

// ── security ─────────────────────────────────────────────────────────────

test("a malicious commit message passes through as plain data, never interpreted", () => {
  const summary = toCommitSummary(
    rawCommit({ commit: { message: '"] --> <script>alert(1)</script>', author: null, committer: null } })
  );
  assertEqual(summary.message, '"] --> <script>alert(1)</script>', "kept verbatim as a string");
});

test("a path-traversal-shaped file path passes through as plain data", () => {
  const file = toChangedFile({ filename: "../../../../etc/passwd", status: "added" });
  assertEqual(file.path, "../../../../etc/passwd", "never resolved against any filesystem");
});

test("prototype-pollution-shaped field names in a raw file cause no pollution", () => {
  const file = toChangedFile(
    JSON.parse('{"filename":"a.ts","status":"added","__proto__":{"polluted":true}}') as RawFile
  );
  assertEqual((Object.prototype as Record<string, unknown>).polluted, undefined, "prototype untouched");
  assertEqual(file.path, "a.ts", "mapped normally");
});

await report("Git history mapping and validation tests");
