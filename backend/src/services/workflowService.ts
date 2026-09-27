import { env } from "../config/env.js";
import { normalizeRepositoryPath } from "../parser/dependencyResolver.js";
import type { GithubCredential } from "../types/github.js";
import type { Workflow, WorkflowAnalysis } from "../types/workflows.js";
import { isWorkflowPath, parseWorkflow } from "../workflows/workflowParser.js";
import { fetchRepositorySnapshot } from "./githubService.js";
import { fetchRepositorySources } from "./sourceService.js";

/**
 * Runs the Phase 5 pipeline for one repository.
 *
 * Reuses the Phase 1 snapshot and the Phase 4 archive acquisition unchanged,
 * so GitHub cost stays three API calls regardless of how many workflows,
 * jobs or steps a repository has: metadata, recursive tree, one archive.
 *
 * The credential is threaded through to GitHub and stops there — the workflow
 * parser only ever receives file text.
 */
export async function analyzeWorkflows(
  owner: string,
  repo: string,
  credential?: GithubCredential
): Promise<WorkflowAnalysis> {
  const snapshot = await fetchRepositorySnapshot(owner, repo, credential);

  // Only .github/workflows is inspected; the rest of the tree is not scanned.
  const workflowPaths: string[] = [];
  for (const node of snapshot.tree) {
    if (node.type !== "file") continue;
    const path = normalizeRepositoryPath(node.path);
    if (path !== null && isWorkflowPath(path)) workflowPaths.push(path);
  }
  workflowPaths.sort();

  const workflowsFound = workflowPaths.length;
  const limitReached = workflowsFound > env.workflows.maxWorkflows;
  const selected = workflowPaths.slice(0, env.workflows.maxWorkflows);

  if (selected.length === 0) {
    // A repository with no GitHub Actions is a valid, complete result.
    return {
      repository: snapshot.repository,
      workflows: [],
      stats: {
        workflowsFound: 0,
        workflowsAnalyzed: 0,
        workflowsFailed: 0,
        truncated: false,
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

  const limits = {
    maxJobsPerWorkflow: env.workflows.maxJobsPerWorkflow,
    maxStepsPerJob: env.workflows.maxStepsPerJob,
  };

  const workflows: Workflow[] = [];
  for (const path of selected) {
    const contents = acquisition.sources.get(path);
    if (contents === undefined) {
      // Listed in the tree but missing from the archive (a size limit, or a
      // symlink). Reported rather than silently dropped.
      workflows.push({
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        triggers: [],
        jobs: [],
        jobCount: 0,
        jobsTruncated: false,
        parseError: "Workflow file could not be retrieved",
      });
      continue;
    }

    workflows.push(parseWorkflow(path, contents, limits));
  }

  const workflowsFailed = workflows.filter((w) => w.parseError !== undefined).length;
  const anyInnerTruncation = workflows.some(
    (w) => w.jobsTruncated || w.jobs.some((j) => j.stepsTruncated)
  );

  return {
    repository: snapshot.repository,
    workflows,
    stats: {
      workflowsFound,
      workflowsAnalyzed: workflows.length - workflowsFailed,
      workflowsFailed,
      truncated: limitReached || anyInnerTruncation || snapshot.truncated,
    },
  };
}
