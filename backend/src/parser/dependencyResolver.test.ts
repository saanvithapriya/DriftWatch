/**
 * Tests for internal module resolution against the repository tree.
 *
 * Run with:  npx tsx src/parser/dependencyResolver.test.ts
 */
import { assertEqual, report, test } from "../testHarness.js";
import { detectLanguage, isSupportedSourceFile } from "./languageDetector.js";
import {
  normalizeRepositoryPath,
  resolutionCandidates,
  resolveDependency,
} from "./dependencyResolver.js";

const files = (...paths: string[]): Set<string> => new Set(paths);

// ── language detection ───────────────────────────────────────────────────

test("extensions map to the right grammar", () => {
  assertEqual(detectLanguage("a.js"), "javascript", ".js");
  assertEqual(detectLanguage("a.jsx"), "jsx", ".jsx");
  assertEqual(detectLanguage("a.ts"), "typescript", ".ts");
  assertEqual(detectLanguage("a.tsx"), "tsx", ".tsx");
  assertEqual(detectLanguage("src/deep/a.TSX"), "tsx", "case-insensitive");
});

test("unsupported extensions are not treated as JavaScript", () => {
  for (const path of ["a.py", "a.go", "a.rb", "a.css", "a.json", "a.md", "README", "a"]) {
    assertEqual(detectLanguage(path), null, `unsupported: ${path}`);
    assertEqual(isSupportedSourceFile(path), false, `not a source file: ${path}`);
  }
});

test("a dotfile with no extension is not a source file", () => {
  assertEqual(detectLanguage(".gitignore"), null, "dotfile");
});

// ── path normalization ───────────────────────────────────────────────────

test("paths normalize to POSIX form", () => {
  assertEqual(
    normalizeRepositoryPath("src\\components\\Header.tsx"),
    "src/components/Header.tsx",
    "backslashes converted"
  );
  assertEqual(normalizeRepositoryPath("src//a///b.ts"), "src/a/b.ts", "empty segments dropped");
  assertEqual(normalizeRepositoryPath("./src/a.ts"), "src/a.ts", "leading dot dropped");
  assertEqual(normalizeRepositoryPath("src/./a.ts"), "src/a.ts", "inner dot dropped");
  assertEqual(normalizeRepositoryPath("src/x/../a.ts"), "src/a.ts", "dotdot collapsed");
});

test("a path escaping the repository root is rejected", () => {
  assertEqual(normalizeRepositoryPath("../outside.ts"), null, "one level up");
  assertEqual(normalizeRepositoryPath("../../etc/passwd"), null, "traversal");
  assertEqual(normalizeRepositoryPath("src/../../outside.ts"), null, "net escape");
});

// ── candidate ordering ───────────────────────────────────────────────────

test("candidates are tried in a documented, deterministic order", () => {
  assertEqual(
    resolutionCandidates("src/foo"),
    [
      "src/foo",
      "src/foo.ts",
      "src/foo.tsx",
      "src/foo.js",
      "src/foo.jsx",
      "src/foo/index.ts",
      "src/foo/index.tsx",
      "src/foo/index.js",
      "src/foo/index.jsx",
    ],
    "exact, then extensions, then index files"
  );
});

// ── relative resolution ──────────────────────────────────────────────────

test("extensionless imports resolve for every supported extension", () => {
  for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
    const target = `src/foo${extension}`;
    const outcome = resolveDependency("src/App.tsx", "./foo", { files: files(target) });
    assertEqual(outcome.kind, "internal", `resolved ${extension}`);
    assertEqual(outcome.target, target, `to ${target}`);
  }
});

test("explicitly specified extensions resolve", () => {
  const outcome = resolveDependency("src/App.tsx", "./foo.ts", {
    files: files("src/foo.ts"),
  });
  assertEqual(outcome.target, "src/foo.ts", "exact match");
});

test("directory imports resolve to index files in order", () => {
  for (const indexFile of ["index.ts", "index.tsx", "index.js", "index.jsx"]) {
    const target = `src/components/Button/${indexFile}`;
    const outcome = resolveDependency("src/App.tsx", "./components/Button", {
      files: files(target),
    });
    assertEqual(outcome.target, target, `resolved ${indexFile}`);
  }
});

test("when several candidates exist the documented order decides", () => {
  const outcome = resolveDependency("src/App.tsx", "./foo", {
    files: files("src/foo.js", "src/foo.ts", "src/foo.tsx", "src/foo/index.ts"),
  });
  assertEqual(outcome.target, "src/foo.ts", ".ts wins");
});

test("parent imports resolve", () => {
  assertEqual(
    resolveDependency("src/pages/Home.tsx", "../App.tsx", { files: files("src/App.tsx") })
      .target,
    "src/App.tsx",
    "one level up"
  );
  assertEqual(
    resolveDependency("src/a/b/c.ts", "../../shared.ts", { files: files("src/shared.ts") })
      .target,
    "src/shared.ts",
    "two levels up"
  );
});

test("a file at the repository root resolves its siblings", () => {
  assertEqual(
    resolveDependency("index.ts", "./config", { files: files("config.ts") }).target,
    "config.ts",
    "root sibling"
  );
});

test("resolution never escapes the repository root", () => {
  // From src/App.tsx these climb past the root, so nothing may resolve even
  // though files with those names exist in the set.
  for (const specifier of ["../../etc/passwd", "../../../x", "../../outside"]) {
    const outcome = resolveDependency("src/App.tsx", specifier, {
      files: files("outside.ts", "etc/passwd", "x.ts"),
    });
    assertEqual(outcome.kind, "unresolved", `blocked: ${specifier}`);
    assertEqual(outcome.target, undefined, `no target for ${specifier}`);
  }
});

test("climbing to the repository root is allowed, escaping it is not", () => {
  // `../outside` from src/App.tsx is simply `outside.ts` at the root: inside
  // the repository, so it must resolve.
  assertEqual(
    resolveDependency("src/App.tsx", "../outside", { files: files("outside.ts") }).target,
    "outside.ts",
    "root-level sibling resolves"
  );
  // One level further is outside the repository entirely.
  assertEqual(
    resolveDependency("src/App.tsx", "../../outside", { files: files("outside.ts") }).kind,
    "unresolved",
    "escape blocked"
  );
});

test("a relative import with no matching file is unresolved, not invented", () => {
  const outcome = resolveDependency("src/App.tsx", "./missing", { files: files("src/other.ts") });
  assertEqual(outcome.kind, "unresolved", "unresolved");
  assertEqual(outcome.target, undefined, "no target invented");
});

test("non-source targets still resolve when the file exists", () => {
  const outcome = resolveDependency("src/App.tsx", "./styles.css", {
    files: files("src/styles.css"),
  });
  assertEqual(outcome.target, "src/styles.css", "stylesheet resolved");
});

test("resolution is case-sensitive, matching GitHub's tree", () => {
  const outcome = resolveDependency("src/App.tsx", "./Header", { files: files("src/header.tsx") });
  assertEqual(outcome.kind, "unresolved", "case must match");
});

// ── external classification ──────────────────────────────────────────────

test("bare specifiers are external", () => {
  for (const specifier of ["react", "axios", "lodash", "express", "react-router-dom"]) {
    assertEqual(
      resolveDependency("src/App.tsx", specifier, { files: files("src/react.ts") }).kind,
      "external",
      `${specifier} is external`
    );
  }
});

test("a bare specifier is external even when a same-named file exists", () => {
  // `import "react"` must not attach to `react.ts` in the repository.
  const outcome = resolveDependency("src/App.tsx", "react", { files: files("react.ts") });
  assertEqual(outcome.kind, "external", "not captured by a coincidental filename");
});

test("scoped and deep package paths are external", () => {
  assertEqual(
    resolveDependency("a.ts", "@scope/pkg/sub", { files: files() }).kind,
    "external",
    "scoped package"
  );
});

test("absolute specifiers are unresolved", () => {
  assertEqual(
    resolveDependency("a.ts", "/etc/passwd", { files: files("etc/passwd") }).kind,
    "unresolved",
    "absolute path rejected"
  );
});

// ── aliases ──────────────────────────────────────────────────────────────

test("alias prefixes resolve when a deterministic mapping exists", () => {
  const aliases = new Map([["@", "src"]]);
  const outcome = resolveDependency("src/pages/Home.tsx", "@/components/Header", {
    files: files("src/components/Header.tsx"),
    aliases,
  });
  assertEqual(outcome.target, "src/components/Header.tsx", "alias applied");
});

test("an alias that matches no file is unresolved, not external", () => {
  const aliases = new Map([["@", "src"]]);
  const outcome = resolveDependency("a.ts", "@/missing", { files: files(), aliases });
  assertEqual(outcome.kind, "unresolved", "looked internal, so unresolved");
});

test("without an alias map the prefix stays external", () => {
  const outcome = resolveDependency("a.ts", "@/components/Header", {
    files: files("src/components/Header.tsx"),
  });
  assertEqual(outcome.kind, "external", "never guessed");
});

test("resolution is deterministic", () => {
  const options = { files: files("src/foo.ts", "src/foo.js") };
  assertEqual(
    resolveDependency("src/a.ts", "./foo", options),
    resolveDependency("src/a.ts", "./foo", options),
    "same input, same output"
  );
});

test("bare '.' and '..' are relative, not packages", () => {
  // Regression: `require(".")` was classified as an external package because
  // only "./" and "../" prefixes counted as relative.
  assertEqual(
    resolveDependency("src/app/main.ts", ".", { files: files("src/app/index.ts") }).target,
    "src/app/index.ts",
    "'.' is this directory's index"
  );
  assertEqual(
    resolveDependency("src/app/main.ts", "..", { files: files("src/index.ts") }).target,
    "src/index.ts",
    "'..' is the parent directory's index"
  );
  assertEqual(
    resolveDependency("src/app/main.ts", ".", { files: files() }).kind,
    "unresolved",
    "with no index file it is unresolved, never external"
  );
});

test("a dotted specifier still cannot escape the repository root", () => {
  assertEqual(
    resolveDependency("main.ts", "..", { files: files("index.ts") }).kind,
    "unresolved",
    "'..' from the root escapes"
  );
});

await report("dependency resolution tests");
