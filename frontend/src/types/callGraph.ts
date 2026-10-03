/**
 * Function call graph DTO, mirroring the backend contract.
 *
 * Declared separately from the backend's copy on purpose: the frontend
 * consumes the API shape, not backend implementation types.
 *
 * Everything here is statically inferred from source text — Call Flow is not
 * runtime tracing, and nothing in this shape reflects actual execution.
 */

export type CallGraphFunctionKind =
  | "function-declaration"
  | "function-expression"
  | "arrow-function"
  | "method"
  | "constructor"
  | "class-property-function";

export interface CallGraphFunctionNode {
  id: string;
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
  callExpression: string;
  line: number;
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
  functionsDiscovered: number;
  functionsReachable: number;
  edges: number;
  unresolvedCalls: number;
  externalCalls: number;
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
  entryPoint: CallGraphEntryPointInfo | null;
  nodes: CallGraphFunctionNode[];
  edges: CallGraphEdge[];
  availableEntryPoints: CallGraphEntryPoint[];
  stats: CallGraphStats;
  truncated: boolean;
  truncationReason?: CallGraphTruncationReason;
}
