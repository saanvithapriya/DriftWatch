/**
 * Dependency graph DTO, mirroring the backend contract.
 *
 * Declared separately from the backend's copy on purpose: the frontend
 * consumes the API shape, not backend implementation types, so the two layers
 * stay decoupled. No Tree-sitter types ever appear here.
 */

export interface DependencyNode {
  id: string;
  path: string;
  label: string;
  type: "file";
}

export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  type: "internal";
}

export interface DependencyStats {
  filesAnalyzed: number;
  filesSkipped: number;
  filesFailed: number;
  dependenciesFound: number;
  internalDependencies: number;
  externalImports: number;
  externalPackages: number;
  unresolvedImports: number;
  truncated: boolean;
}

export interface DependencyRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface DependencyAnalysis {
  repository: DependencyRepositoryInfo;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  stats: DependencyStats;
}
