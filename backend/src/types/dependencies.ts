/**
 * Dependency graph DTO — the contract between backend and frontend.
 *
 * Plain data only: no Tree-sitter AST, no Octokit objects, no credentials, no
 * Express types. The frontend consumes exactly this shape.
 */

export interface DependencyGraphNode {
  /** Repository path; also the node id, which makes ids deterministic. */
  id: string;
  path: string;
  /** Final path segment, for display. */
  label: string;
  type: "file";
}

export interface DependencyGraphEdge {
  /** `source->target`, deterministic and unique. */
  id: string;
  source: string;
  target: string;
  type: "internal";
}

export interface DependencyGraphStats {
  /** Source files successfully parsed. */
  filesAnalyzed: number;
  /** Supported source files left out because a limit was reached. */
  filesSkipped: number;
  /** Files that matched a supported extension but could not be parsed. */
  filesFailed: number;
  /** Every module specifier seen, whatever its classification. */
  dependenciesFound: number;
  /** Deduplicated internal edges in the graph. */
  internalDependencies: number;
  /** Import statements pointing at packages. */
  externalImports: number;
  /** Distinct external packages referenced. */
  externalPackages: number;
  /** Specifiers that looked internal but matched no repository file. */
  unresolvedImports: number;
  /** True when analysis covered only part of the repository. */
  truncated: boolean;
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  stats: DependencyGraphStats;
}

export interface DependencyRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface DependencyAnalysis {
  repository: DependencyRepositoryInfo;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  stats: DependencyGraphStats;
}

export interface DependencyAnalysisResponse {
  success: true;
  data: DependencyAnalysis;
}
