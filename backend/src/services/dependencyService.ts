import { env } from "../config/env.js";
import { buildDependencyGraph } from "../parser/dependencyGraph.js";
import { isSupportedSourceFile } from "../parser/languageDetector.js";
import { normalizeRepositoryPath } from "../parser/dependencyResolver.js";
import type { DependencyAnalysis } from "../types/dependencies.js";
import type { GithubCredential } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { fetchRepositorySnapshot } from "./githubService.js";
import { fetchRepositorySources, selectSourceFiles } from "./sourceService.js";

/**
 * Runs the Phase 4 pipeline for one repository.
 *
 * GitHub cost is three API calls regardless of repository size: metadata,
 * recursive tree, and one archive download for all file contents.
 *
 * The credential is threaded through to GitHub and stops there — it is never
 * passed to the parser, which only ever receives source text.
 */
export async function analyzeDependencies(
  owner: string,
  repo: string,
  credential?: GithubCredential
): Promise<DependencyAnalysis> {
  const snapshot = await fetchRepositorySnapshot(owner, repo, credential);

  if (snapshot.sizeKb > env.analysis.maxRepositorySizeKb) {
    throw new AppError(
      413,
      "This repository is too large for dependency analysis."
    );
  }

  // Every file in the repository, normalized, so imports resolve against what
  // actually exists rather than against the local filesystem.
  const repositoryFiles = new Set<string>();
  const supportedPaths: string[] = [];

  for (const node of snapshot.tree) {
    if (node.type !== "file") continue;
    const path = normalizeRepositoryPath(node.path);
    if (path === null) continue;

    repositoryFiles.add(path);
    if (isSupportedSourceFile(path)) supportedPaths.push(path);
  }

  const { selected, skipped } = selectSourceFiles(
    supportedPaths,
    env.analysis.maxSourceFiles
  );

  if (selected.length === 0) {
    // An empty repository, or one with no JavaScript/TypeScript in it.
    return {
      repository: snapshot.repository,
      nodes: [],
      edges: [],
      stats: {
        filesAnalyzed: 0,
        filesSkipped: skipped,
        filesFailed: 0,
        dependenciesFound: 0,
        internalDependencies: 0,
        externalImports: 0,
        externalPackages: 0,
        unresolvedImports: 0,
        truncated: snapshot.truncated,
      },
    };
  }

  const acquisition = await fetchRepositorySources(
    snapshot.repository.owner,
    snapshot.repository.name,
    snapshot.repository.defaultBranch,
    selected,
    credential
  );

  const graph = buildDependencyGraph({
    sources: acquisition.sources,
    repositoryFiles,
    // Truncated if GitHub cut the tree short, if a limit reduced the file
    // selection, or if the archive did not yield everything requested.
    truncated:
      snapshot.truncated || skipped > 0 || acquisition.truncated,
    filesSkipped: skipped + acquisition.filesSkipped,
  });

  return {
    repository: snapshot.repository,
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats,
  };
}
