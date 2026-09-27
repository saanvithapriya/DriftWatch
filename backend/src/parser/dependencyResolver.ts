import type { DependencyKind } from "./parserTypes.js";

/**
 * Extensions tried for an extensionless import, in this exact order. The order
 * is fixed so resolution is deterministic when several candidates exist:
 * TypeScript before JavaScript, and `.tsx`/`.jsx` before their plain
 * counterparts, matching how bundlers in this ecosystem usually resolve.
 */
export const RESOLUTION_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
];

/** Index files tried when a specifier points at a directory, in order. */
export const INDEX_FILENAMES: readonly string[] = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
];

/**
 * Normalizes a repository path to POSIX form and collapses `.`/`..`.
 *
 * Returns null when the path climbs above the repository root: an import of
 * `../../../etc/passwd` must never resolve to anything, and resolution is not
 * permitted to escape the repository.
 */
export function normalizeRepositoryPath(path: string): string | null {
  const segments = path.replace(/\\/g, "/").split("/");
  const out: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null; // escaped the repository root
      out.pop();
      continue;
    }
    out.push(segment);
  }

  return out.join("/");
}

/** Directory portion of a repository path (`src/a/b.ts` -> `src/a`). */
function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export interface ResolutionOutcome {
  kind: DependencyKind;
  /** Repository path, present only when kind is "internal". */
  target?: string;
}

/**
 * A specifier is relative when it starts with `./` or `../`, or is exactly
 * `.` or `..`. The bare forms are legitimate CommonJS (`require(".")` means
 * this directory's index) and would otherwise be misclassified as packages.
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

/**
 * Candidate repository paths for a base path, in deterministic order:
 * the exact path, then each extension, then each index file.
 */
export function resolutionCandidates(base: string): string[] {
  const candidates: string[] = [base];

  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.push(`${base}${extension}`);
  }
  for (const indexFile of INDEX_FILENAMES) {
    candidates.push(base === "" ? indexFile : `${base}/${indexFile}`);
  }

  return candidates;
}

export interface ResolverOptions {
  /** Every file path present in the repository, POSIX-normalized. */
  files: ReadonlySet<string>;
  /**
   * Path alias prefixes from a deterministic config, e.g. `@/` -> `src/`.
   * Only populated when the mapping could be read unambiguously.
   */
  aliases?: ReadonlyMap<string, string>;
}

/**
 * Resolves one module specifier against the repository's file list.
 *
 * The repository tree is the only source of truth — the local filesystem is
 * never consulted, and a target file is never invented. Anything that is not a
 * relative or aliased path that lands on a real file is classified rather than
 * guessed: bare specifiers are `external`, and everything else `unresolved`.
 */
export function resolveDependency(
  fromPath: string,
  specifier: string,
  options: ResolverOptions
): ResolutionOutcome {
  const { files, aliases } = options;

  let base: string | null = null;
  // Distinguishes "this looked like a repository path" from "this is a bare
  // package specifier", so an alias that escapes the root is reported as
  // unresolved rather than silently reclassified as an external package.
  let looksLikeRepositoryPath = false;

  if (isRelativeSpecifier(specifier)) {
    looksLikeRepositoryPath = true;
    const directory = dirnameOf(fromPath);
    base = normalizeRepositoryPath(
      directory === "" ? specifier : `${directory}/${specifier}`
    );
  } else if (specifier.startsWith("/")) {
    // Absolute specifiers have no meaning without a configured root.
    return { kind: "unresolved" };
  } else if (aliases !== undefined) {
    for (const [prefix, replacement] of aliases) {
      if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
        looksLikeRepositoryPath = true;
        const rest = specifier.slice(prefix.length).replace(/^\//, "");
        base = normalizeRepositoryPath(
          rest === "" ? replacement : `${replacement}/${rest}`
        );
        break;
      }
    }
  }

  if (base === null) {
    // Either a bare specifier such as `react` / `lodash/merge`, or a path that
    // climbed above the repository root.
    return looksLikeRepositoryPath
      ? { kind: "unresolved" }
      : { kind: "external" };
  }

  for (const candidate of resolutionCandidates(base)) {
    if (files.has(candidate)) {
      return { kind: "internal", target: candidate };
    }
  }

  // It looked like a repository path but no such file exists.
  return { kind: "unresolved" };
}
