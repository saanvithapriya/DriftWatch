export type RepositoryTreeNodeType = "file" | "directory";

export interface RepositoryTreeNode {
  path: string;
  type: RepositoryTreeNodeType;
}

export interface RepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface RepositoryTree {
  repository: RepositoryInfo;
  tree: RepositoryTreeNode[];
  /** False when GitHub returned only part of the tree. */
  truncated: boolean;
}

export interface GithubTreeResponse {
  success: true;
  data: RepositoryTree;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
}
