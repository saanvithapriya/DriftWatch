import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import tarStream from "tar-stream";
import { resolveOctokit } from "../config/octokit.js";
import { env } from "../config/env.js";
import { ALIAS_CONFIG_FILES } from "../parser/aliasConfig.js";
import type { GithubCredential } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { toAppError } from "./githubService.js";

export interface SourceAcquisition {
  /** Repository path -> file contents, for the files actually analyzed. */
  sources: Map<string, string>;
  /** Supported source files left out because a limit was reached. */
  filesSkipped: number;
  /** True when analysis covers only part of the repository. */
  truncated: boolean;
}

/**
 * Chooses which source files to analyze, deterministically.
 *
 * Candidates are sorted by path and taken in order, so the same repository
 * snapshot always yields the same selection. When the file limit bites, the
 * remainder is reported as skipped rather than quietly dropped.
 */
export function selectSourceFiles(
  supportedPaths: readonly string[],
  maxFiles: number
): { selected: string[]; skipped: number } {
  const sorted = [...supportedPaths].sort();
  if (sorted.length <= maxFiles) {
    return { selected: sorted, skipped: 0 };
  }
  return {
    selected: sorted.slice(0, maxFiles),
    skipped: sorted.length - maxFiles,
  };
}

/**
 * GitHub tarballs nest everything under a single `owner-repo-sha/` directory.
 * Strips it, returning null for the directory entry itself.
 */
function stripArchiveRoot(entryPath: string): string | null {
  const index = entryPath.indexOf("/");
  if (index === -1) return null;
  const rest = entryPath.slice(index + 1);
  return rest === "" ? null : rest;
}

/**
 * Downloads the repository archive and extracts the requested files.
 *
 * Source acquisition strategy: **one** GitHub API call for the entire
 * repository's contents, rather than one per file. Fetching blobs
 * individually would be an N+1 against an API that allows 60 anonymous
 * requests an hour, so a few hundred files would exhaust the quota outright.
 * The archive is streamed through gunzip and tar, and only the selected paths
 * are kept in memory.
 *
 * Repository code is treated purely as data: it is never executed, and no
 * archive entry is ever written to disk.
 */
export async function fetchRepositorySources(
  owner: string,
  repo: string,
  ref: string,
  wantedPaths: readonly string[],
  credential?: GithubCredential
): Promise<SourceAcquisition> {
  const octokit = resolveOctokit(credential);

  // Config files are read too, so path aliases can be resolved.
  const wanted = new Set<string>(wantedPaths);
  for (const configFile of ALIAS_CONFIG_FILES) wanted.add(configFile);

  let archive: Buffer;
  try {
    const response = await octokit.rest.repos.downloadTarballArchive({
      owner,
      repo,
      ref,
    });
    archive = Buffer.from(response.data as ArrayBuffer);
  } catch (error) {
    throw toAppError(error);
  }

  const sources = new Map<string, string>();
  let totalBytes = 0;
  let skippedByLimit = 0;

  const extract = tarStream.extract();

  extract.on("entry", (header, stream, next) => {
    const path =
      header.type === "file" ? stripArchiveRoot(header.name) : null;

    if (path === null || !wanted.has(path)) {
      // Not wanted: drain without buffering.
      stream.on("end", next);
      stream.resume();
      return;
    }

    const size = header.size ?? 0;
    if (
      size > env.analysis.maxFileSizeBytes ||
      totalBytes + size > env.analysis.maxTotalSourceBytes
    ) {
      skippedByLimit += 1;
      stream.on("end", next);
      stream.resume();
      return;
    }

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    stream.on("end", () => {
      const content = Buffer.concat(chunks);
      totalBytes += content.length;
      sources.set(path, content.toString("utf8"));
      next();
    });
    stream.on("error", () => next());
  });

  await new Promise<void>((resolve, reject) => {
    extract.on("finish", () => resolve());
    extract.on("error", (error: unknown) => reject(error));
    Readable.from(archive)
      .pipe(createGunzip())
      .on("error", reject)
      .pipe(extract);
  }).catch(() => {
    throw new AppError(502, "Failed to read the repository archive");
  });

  // Config files were fetched for alias resolution, not analysis.
  const requested = new Set(wantedPaths);
  let analyzedCount = 0;
  for (const path of sources.keys()) {
    if (requested.has(path)) analyzedCount += 1;
  }

  return {
    sources,
    filesSkipped: skippedByLimit,
    truncated: skippedByLimit > 0 || analyzedCount < wantedPaths.length,
  };
}
