import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { buildCallGraphIndex, type CallGraphIndex } from "../parser/callGraphBuilder.js";
import {
  MAX_CALL_GRAPH_DEPTH,
  MAX_CALL_GRAPH_NODES,
  selectDefaultEntryPoint,
  traverseCallGraph,
} from "../parser/callGraphTraversal.js";
import { isSupportedSourceFile } from "../parser/languageDetector.js";
import { normalizeRepositoryPath } from "../parser/dependencyResolver.js";
import type { CallGraphAnalysis, CallGraphEntryPoint } from "../types/callGraph.js";
import type { GithubCredential } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { fetchRepositorySnapshot } from "./githubService.js";
import { fetchRepositorySources, selectSourceFiles } from "./sourceService.js";

/**
 * Runs the Phase 6 pipeline for one repository: the same Phase 4 acquisition
 * (snapshot + one archive download), then static function/call extraction,
 * then a traversal from the chosen entry point.
 *
 * The credential is threaded through to GitHub exactly as in every other
 * service and stops there — the parser only ever receives file text.
 */

interface CacheEntry {
  builtAt: number;
  index: CallGraphIndex;
  repository: { owner: string; name: string; defaultBranch: string };
  pipelineTruncated: boolean;
}

/**
 * A short-lived, in-memory cache of the built function/call index, keyed by
 * repository *and* by the caller's identity.
 *
 * This is what makes "change the entry point" cheap (spec section 17): a
 * second request for the same repository within the TTL reuses the already
 * parsed index and only re-runs the traversal — no GitHub calls, no
 * re-parsing. It deliberately does NOT persist beyond this process and does
 * NOT grow without bound, for the same reason `githubService.ts` documents
 * for not caching at all: once private repositories are reachable, a cache
 * keyed on the repository alone is a data leak between users who are not
 * equally entitled to see it. The key here always includes the caller's
 * identity (a hash of their credential, or a fixed anonymous marker), so an
 * authenticated user's result is never served to a different caller — and a
 * short TTL plus a small LRU cap bound both staleness and memory.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, CacheEntry>();

function callerIdentity(credential?: GithubCredential): string {
  if (credential === undefined) return "anonymous";
  return createHash("sha256").update(credential.token).digest("hex");
}

function cacheKey(owner: string, repo: string, ref: string, credential?: GithubCredential): string {
  return `${callerIdentity(credential)}::${owner}/${repo}@${ref}`;
}

function readCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (entry === undefined) return null;
  if (Date.now() - entry.builtAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency for the LRU eviction below.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeCache(key: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

function emptyEntryPoints(index: CallGraphIndex): CallGraphEntryPoint[] {
  return index.allFunctions.map((fn) => ({
    id: fn.id,
    file: fn.file,
    name: fn.name,
    startLine: fn.startLine,
    endLine: fn.endLine,
  }));
}

export async function analyzeCallGraph(
  owner: string,
  repo: string,
  entryPoint: string | undefined,
  credential?: GithubCredential
): Promise<CallGraphAnalysis> {
  const snapshot = await fetchRepositorySnapshot(owner, repo, credential);

  if (snapshot.sizeKb > env.analysis.maxRepositorySizeKb) {
    throw new AppError(413, "This repository is too large for call graph analysis.");
  }

  const key = cacheKey(
    snapshot.repository.owner,
    snapshot.repository.name,
    snapshot.repository.defaultBranch,
    credential
  );

  let cached = readCache(key);

  if (cached === null) {
    const repositoryFiles = new Set<string>();
    const supportedPaths: string[] = [];

    for (const node of snapshot.tree) {
      if (node.type !== "file") continue;
      const path = normalizeRepositoryPath(node.path);
      if (path === null) continue;

      repositoryFiles.add(path);
      if (isSupportedSourceFile(path)) supportedPaths.push(path);
    }

    const { selected, skipped } = selectSourceFiles(supportedPaths, env.analysis.maxSourceFiles);

    if (selected.length === 0) {
      // No JavaScript/TypeScript in this repository — a complete, empty
      // result, not a failure.
      const index = buildCallGraphIndex({ sources: new Map(), repositoryFiles });
      cached = {
        builtAt: Date.now(),
        index,
        repository: snapshot.repository,
        pipelineTruncated: snapshot.truncated || skipped > 0,
      };
      writeCache(key, cached);
    } else {
      const acquisition = await fetchRepositorySources(
        snapshot.repository.owner,
        snapshot.repository.name,
        snapshot.repository.defaultBranch,
        selected,
        credential
      );

      const index = buildCallGraphIndex({ sources: acquisition.sources, repositoryFiles });
      cached = {
        builtAt: Date.now(),
        index,
        repository: snapshot.repository,
        pipelineTruncated:
          snapshot.truncated || skipped > 0 || acquisition.truncated,
      };
      writeCache(key, cached);
    }
  }

  const { index, repository, pipelineTruncated } = cached;

  let entryFunctionId: string | null;
  if (entryPoint !== undefined) {
    if (!index.functionsById.has(entryPoint)) {
      throw new AppError(400, "Unknown entry point function for this repository.");
    }
    entryFunctionId = entryPoint;
  } else {
    entryFunctionId = selectDefaultEntryPoint(index);
  }

  const availableEntryPoints = emptyEntryPoints(index);

  if (entryFunctionId === null) {
    return {
      repository,
      entryPoint: null,
      nodes: [],
      edges: [],
      availableEntryPoints,
      stats: {
        functionsDiscovered: index.allFunctions.length,
        functionsReachable: 0,
        edges: 0,
        unresolvedCalls: index.unresolvedCalls,
        externalCalls: index.externalCalls,
        maxDepth: 0,
      },
      truncated: pipelineTruncated || index.truncated,
    };
  }

  const traversal = traverseCallGraph(index, entryFunctionId, {
    maxNodes: MAX_CALL_GRAPH_NODES,
    maxDepth: MAX_CALL_GRAPH_DEPTH,
  });

  const entryFn = index.functionsById.get(entryFunctionId);

  const truncated = pipelineTruncated || index.truncated || traversal.truncated;

  return {
    repository,
    entryPoint:
      entryFn === undefined
        ? null
        : { functionId: entryFn.id, file: entryFn.file, name: entryFn.name },
    nodes: traversal.nodes,
    edges: traversal.edges,
    availableEntryPoints,
    stats: {
      functionsDiscovered: index.allFunctions.length,
      functionsReachable: traversal.nodes.length,
      edges: traversal.edges.length,
      unresolvedCalls: index.unresolvedCalls,
      externalCalls: index.externalCalls,
      maxDepth: traversal.maxDepth,
    },
    truncated,
    ...(traversal.truncationReason !== undefined
      ? { truncationReason: traversal.truncationReason }
      : {}),
  };
}

// Exposed only for tests: lets a test clear cross-test cache pollution
// without reaching into module-private state any other way.
export function __clearCallGraphCacheForTests(): void {
  cache.clear();
}
