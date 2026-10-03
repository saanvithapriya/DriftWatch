/**
 * Function call graph DTO — the contract between backend and frontend.
 *
 * Plain data only: no Tree-sitter AST nodes, no Octokit types, no
 * credentials. Everything here is statically inferred from source text; none
 * of it reflects runtime behaviour, and nothing here was produced by
 * executing repository code.
 */

/** How a function-bearing node was written in source. */
export type CallGraphFunctionKind =
  | "function-declaration"
  | "function-expression"
  | "arrow-function"
  | "method"
  | "constructor"
  | "class-property-function";

export interface CallGraphFunctionNode {
  /** Deterministic id: `<relative-path>::<name>`, or `<path>::<context>@<line>`. */
  id: string;
  /** Repository path, POSIX-normalized. */
  file: string;
  name: string;
  displayName: string;
  startLine: number;
  endLine: number;
  kind: CallGraphFunctionKind;
  exported: boolean;
}

export interface CallGraphEdge {
  source: string;
  target: string;
  /** Call site text as written, e.g. `authenticate()`, truncated if huge. */
  callExpression: string;
  line: number;
  /** How many call sites collapsed into this edge. */
  callCount: number;
}

export interface CallGraphEntryPoint {
  id: string;
  file: string;
  name: string;
  startLine: number;
  endLine: number;
}

export type CallGraphTruncationReason = "max_nodes" | "max_depth";

export interface CallGraphStats {
  /** Every function found across the analyzed files. */
  functionsDiscovered: number;
  /** Functions reachable from the entry point within the graph limits. */
  functionsReachable: number;
  /** Edges in the reachable subgraph. */
  edges: number;
  /** Call sites whose callee could not be statically resolved. */
  unresolvedCalls: number;
  /** Call sites resolved to something outside the repository. */
  externalCalls: number;
  /** Deepest level actually reached from the entry point. */
  maxDepth: number;
}

export interface CallGraphRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface CallGraphEntryPointInfo {
  functionId: string;
  file: string;
  name: string;
}

export interface CallGraphAnalysis {
  repository: CallGraphRepositoryInfo;
  /** Null only when the repository has no statically extractable functions. */
  entryPoint: CallGraphEntryPointInfo | null;
  nodes: CallGraphFunctionNode[];
  edges: CallGraphEdge[];
  availableEntryPoints: CallGraphEntryPoint[];
  stats: CallGraphStats;
  truncated: boolean;
  truncationReason?: CallGraphTruncationReason;
}

export interface CallGraphRequestBody {
  url?: unknown;
  entryPoint?: unknown;
}

export interface CallGraphAnalysisResponse {
  success: true;
  data: CallGraphAnalysis;
}
