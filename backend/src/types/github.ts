/**
 * Application-level (domain) types for GitHub repository ingestion.
 *
 * These deliberately do not reuse Octokit's response types: the API contract
 * exposed to the frontend must stay stable even if the GitHub client changes.
 */

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
  /**
   * True when GitHub could not return the whole tree in one response.
   * The frontend must be able to tell a complete tree from a partial one.
   */
  truncated: boolean;
}

export interface GithubTreeRequestBody {
  url?: unknown;
}

export interface GithubTreeSuccessResponse {
  success: true;
  data: RepositoryTree;
}
