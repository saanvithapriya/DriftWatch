import { env } from "../config/env.js";
import { buildCallGraphIndex } from "../parser/callGraphBuilder.js";
import { buildDependencyGraph } from "../parser/dependencyGraph.js";
import { isSupportedSourceFile } from "../parser/languageDetector.js";
import { normalizeRepositoryPath } from "../parser/dependencyResolver.js";
import { computeImpactGraph } from "../parser/impactTraversal.js";
import type {
  ImpactAnalysis,
  ImpactFunctionAnalysis,
  ImpactFunctionInfo,
} from "../types/history.js";
import type { GithubCredential } from "../types/github.js";
import { fetchTreeAtRef } from "./githubService.js";
import { compareCommits } from "./historyService.js";
import { callerIdentity, createScopedCache } from "./scopedCache.js";
import { fetchRepositorySources, selectSourceFiles } from "./sourceService.js";

/**
 * Phase 7's core feature: static impact analysis.
 *
 * Pipeline (spec section 11): compare commits -> changed files -> Phase 4's
 * dependency graph, built as of the comparison's `head` -> reverse adjacency
 * -> breadth-first traversal from the changed files -> affected files ->
 * optional Phase 6 function-level relationships -> the impact graph.
 *
 * This module only handles acquisition (GitHub calls, archive download) and
 * assembly; the traversal itself is `computeImpactGraph` in
 * `parser/impactTraversal.ts`, kept pure and independently testable, the
 * same way Phase 6 splits `callGraphBuilder.ts` from `callGraphTraversal.ts`.
 * Every dependency fact comes from `buildDependencyGraph` (Phase 4) and, for
 * the optional function-level section, `buildCallGraphIndex` (Phase 6) —
 * neither is reimplemented here, only traversed in the reverse direction.
 *
 * This is static analysis of what statically depends on what. It is never a
 * prediction that anything will actually break at runtime, and the response
 * always says so (see `STANDARD_WARNING`, re-exported from the traversal
 * module).
 */

export { STANDARD_WARNING } from "../parser/impactTraversal.js";

const IMPACT_CACHE_TTL_MS = 5 * 60 * 1000;
const impactCache = createScopedCache<ImpactAnalysis>(IMPACT_CACHE_TTL_MS, 30);

export function clampImpactDepth(raw: unknown): number {
  const max = env.history.maxImpactDepth;
  if (raw === undefined || raw === null) return Math.min(3, max);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return Math.min(3, max);
  return Math.min(n, max);
}

export async function analyzeImpact(
  owner: string,
  repo: string,
  base: string,
  head: string,
  maxDepth: number,
  credential?: GithubCredential
): Promise<ImpactAnalysis> {
  const key = `${callerIdentity(credential)}::${owner}/${repo}::${base}...${head}::${maxDepth}`;
  const cached = impactCache.get(key);
  if (cached !== null) return cached;

  // Reuses the same compare path (and its own cache) as /api/github/compare
  // — a user who already compared these two commits pays no extra GitHub
  // cost here at all.
  const comparison = await compareCommits(owner, repo, base, head, credential);
  const headRef = comparison.head.sha;

  const treeInfo = await fetchTreeAtRef(owner, repo, headRef, credential);

  const repositoryFiles = new Set<string>();
  const supportedPaths: string[] = [];
  for (const node of treeInfo.tree) {
    if (node.type !== "file") continue;
    const path = normalizeRepositoryPath(node.path);
    if (path === null) continue;
    repositoryFiles.add(path);
    if (isSupportedSourceFile(path)) supportedPaths.push(path);
  }

  const { selected, skipped } = selectSourceFiles(supportedPaths, env.analysis.maxSourceFiles);

  const acquisition =
    selected.length > 0
      ? await fetchRepositorySources(
          comparison.repository.owner,
          comparison.repository.name,
          headRef,
          selected,
          credential
        )
      : { sources: new Map<string, string>(), filesSkipped: 0, truncated: false };

  const graph = buildDependencyGraph({
    sources: acquisition.sources,
    repositoryFiles,
    truncated: treeInfo.truncated || skipped > 0 || acquisition.truncated,
    filesSkipped: skipped + acquisition.filesSkipped,
  });

  const traversal = computeImpactGraph(
    graph,
    comparison.files,
    maxDepth,
    env.history.maxImpactFiles
  );

  const functionImpact = buildFunctionImpact(
    acquisition.sources,
    repositoryFiles,
    traversal.changedFiles
  );

  const result: ImpactAnalysis = {
    repository: comparison.repository,
    comparison: { base: comparison.base.sha, head: comparison.head.sha },
    changedFiles: traversal.changedFiles,
    affectedFiles: traversal.affectedFiles,
    nodes: traversal.nodes,
    edges: traversal.edges,
    stats: traversal.stats,
    functionImpact,
    warnings: traversal.warnings,
    truncated: traversal.truncated,
    ...(traversal.truncationReason !== undefined
      ? { truncationReason: traversal.truncationReason }
      : {}),
  };

  impactCache.set(key, result);
  return result;
}

/**
 * Optional function-level impact (spec section 14): reuses Phase 6's
 * extraction and call graph on the exact same source text already fetched
 * for the dependency graph above — zero additional GitHub calls. Finds
 * functions declared in changed files, then their direct, statically known
 * callers. This is deliberately shallow (direct callers only) and labelled
 * as availability rather than claiming line-level precision, per spec:
 * "Function-level analysis available" rather than exact changed lines.
 */
const MAX_FUNCTION_IMPACT_ENTRIES = 100;

function buildFunctionImpact(
  sources: ReadonlyMap<string, string>,
  repositoryFiles: ReadonlySet<string>,
  changedFiles: readonly string[]
): ImpactFunctionAnalysis {
  if (sources.size === 0) {
    return { available: false, changedFunctions: [], affectedFunctions: [] };
  }

  const index = buildCallGraphIndex({ sources, repositoryFiles });
  const changedFileSet = new Set(changedFiles);

  const changedFunctions: ImpactFunctionInfo[] = index.allFunctions
    .filter((fn) => changedFileSet.has(fn.file))
    .slice(0, MAX_FUNCTION_IMPACT_ENTRIES)
    .map((fn) => ({ id: fn.id, file: fn.file, name: fn.name }));

  // Reverse the (caller -> callee) adjacency to find, for each changed
  // function, who statically calls it.
  const callers = new Map<string, Set<string>>();
  for (const [callerId, callEdges] of index.adjacency) {
    for (const edge of callEdges) {
      let set = callers.get(edge.target);
      if (set === undefined) {
        set = new Set();
        callers.set(edge.target, set);
      }
      set.add(callerId);
    }
  }

  const affectedIds = new Set<string>();
  for (const fn of changedFunctions) {
    for (const callerId of callers.get(fn.id) ?? []) {
      if (!changedFileSet.has(index.functionsById.get(callerId)?.file ?? "")) {
        affectedIds.add(callerId);
      }
    }
  }

  const affectedFunctions: ImpactFunctionInfo[] = [...affectedIds]
    .sort()
    .slice(0, MAX_FUNCTION_IMPACT_ENTRIES)
    .map((id) => {
      const fn = index.functionsById.get(id);
      return { id, file: fn?.file ?? "", name: fn?.name ?? "" };
    });

  return { available: true, changedFunctions, affectedFunctions };
}
