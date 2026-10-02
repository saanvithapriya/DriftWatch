import type { CallGraphEdge, CallGraphFunctionNode } from "../types/callGraph.js";
import { collectAliases } from "./aliasConfig.js";
import { analyzeFunctionsAndCalls } from "./functionExtractor.js";
import { isSupportedSourceFile } from "./languageDetector.js";
import { resolveCallSite } from "./callGraphResolver.js";
import type { ExtractedFunction, FileFunctionIndex } from "./callGraphTypes.js";

/**
 * Builds the whole-repository static call graph from parsed sources.
 *
 * One pass per file (function/call/import/export extraction is already
 * combined in `analyzeFunctionsAndCalls`), then a single cross-file
 * resolution pass — no file is parsed twice, and no additional GitHub or
 * filesystem access happens here at all; this module only ever sees text
 * already in memory.
 *
 * Determinism is a hard requirement: functions and edges are accumulated in
 * maps keyed by id and sorted before being returned, exactly like
 * `dependencyGraph.ts`, so nothing here depends on object insertion order,
 * `Promise` completion order, or archive entry order.
 */

/** Defensive ceiling on the whole-repository graph, independent of the
 *  per-entry-point traversal limits. Exists purely to bound memory and
 *  response size against a pathological file (Security section 20: "huge
 *  function counts", "huge call counts") — realistic repositories, already
 *  bounded by Phase 4's file-count and file-size limits, never approach it. */
const MAX_TOTAL_FUNCTIONS = 4000;
const MAX_TOTAL_EDGES = 20000;

export interface BuildCallGraphInput {
  sources: ReadonlyMap<string, string>;
  repositoryFiles: ReadonlySet<string>;
}

export interface CallGraphIndex {
  /**
   * Keyed by id, but the value is the richer internal `ExtractedFunction` —
   * `isDefaultExport` is needed for default entry-point selection
   * (`callGraphTraversal.ts`) and is stripped only when the public DTO is
   * assembled, via `toFunctionNode` below.
   */
  functionsById: Map<string, ExtractedFunction>;
  /** Full, sorted list — the same objects as in `functionsById`. */
  allFunctions: ExtractedFunction[];
  /** Forward adjacency: function id -> edges leaving it, sorted. */
  adjacency: Map<string, CallGraphEdge[]>;
  unresolvedCalls: number;
  externalCalls: number;
  /** True when a defensive whole-graph limit (not a traversal limit) was hit. */
  truncated: boolean;
}

/** Strips internal-only bookkeeping, producing the public DTO shape. */
export function toFunctionNode(fn: ExtractedFunction): CallGraphFunctionNode {
  return {
    id: fn.id,
    file: fn.file,
    name: fn.name,
    displayName: fn.displayName,
    startLine: fn.startLine,
    endLine: fn.endLine,
    kind: fn.kind,
    exported: fn.exported,
  };
}

export function buildCallGraphIndex(input: BuildCallGraphInput): CallGraphIndex {
  const { sources, repositoryFiles } = input;
  const aliases = collectAliases(sources);

  const fileIndexByPath = new Map<string, FileFunctionIndex>();
  const allExtracted: ExtractedFunction[] = [];

  for (const [path, content] of sources) {
    if (!isSupportedSourceFile(path)) continue;
    const index = analyzeFunctionsAndCalls(path, content);
    fileIndexByPath.set(path, index);
    if (!index.failed) allExtracted.push(...index.functions);
  }

  // Deterministic ordering throughout: sorted by id, which is itself
  // path-then-name-then-line, so the same source always yields the same
  // sequence regardless of Map/archive iteration order.
  allExtracted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let truncated = false;
  const kept = allExtracted.length > MAX_TOTAL_FUNCTIONS
    ? (() => {
        truncated = true;
        return allExtracted.slice(0, MAX_TOTAL_FUNCTIONS);
      })()
    : allExtracted;

  const functionsById = new Map<string, ExtractedFunction>();
  for (const fn of kept) functionsById.set(fn.id, fn);

  const resolverCtx = { repositoryFiles, aliases, fileIndexByPath };

  const edgesByKey = new Map<string, CallGraphEdge>();
  let unresolvedCalls = 0;
  let externalCalls = 0;

  for (const [file, index] of fileIndexByPath) {
    if (index.failed) continue;

    for (const call of index.callSites) {
      if (call.containingFunctionId === null) continue; // module-level; not a graph edge
      if (!functionsById.has(call.containingFunctionId)) continue; // truncated away above

      const resolved = resolveCallSite(resolverCtx, file, call);

      if (resolved.kind === "internal") {
        if (!functionsById.has(resolved.targetId)) {
          // Resolved to a real function, but one truncated away by the
          // defensive cap above. Honest to call this unresolved rather than
          // silently dropping it, unless it is only a speculative callback
          // reference, in which case dropping it silently is correct.
          if (!call.isCallback) unresolvedCalls += 1;
          continue;
        }

        const key = `${call.containingFunctionId}->${resolved.targetId}`;
        const existing = edgesByKey.get(key);
        if (existing === undefined) {
          if (edgesByKey.size >= MAX_TOTAL_EDGES) {
            truncated = true;
            continue;
          }
          edgesByKey.set(key, {
            source: call.containingFunctionId,
            target: resolved.targetId,
            callExpression: call.text,
            line: call.line,
            callCount: 1,
          });
        } else {
          existing.callCount += 1;
        }
        continue;
      }

      // A callback-heuristic reference that did not resolve is simply
      // dropped — it never asserted a call exists, so its absence is not a
      // finding worth counting.
      if (call.isCallback) continue;

      if (resolved.kind === "external") externalCalls += 1;
      else unresolvedCalls += 1;
    }
  }

  const allFunctions = [...functionsById.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const adjacency = new Map<string, CallGraphEdge[]>();
  for (const edge of edgesByKey.values()) {
    let list = adjacency.get(edge.source);
    if (list === undefined) {
      list = [];
      adjacency.set(edge.source, list);
    }
    list.push(edge);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : a.line - b.line));
  }

  return {
    functionsById,
    allFunctions,
    adjacency,
    unresolvedCalls,
    externalCalls,
    truncated,
  };
}
