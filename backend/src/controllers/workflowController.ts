import type { NextFunction, Request, Response } from "express";
import { analyzeWorkflows } from "../services/workflowService.js";
import type { GithubTreeRequestBody } from "../types/github.js";
import type { WorkflowAnalysisResponse } from "../types/workflows.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

/**
 * POST /api/github/workflows
 *
 * Reuses Phase 1's URL validation and Phase 3's session handling verbatim,
 * exactly as the tree and dependency endpoints do.
 */
export async function postGithubWorkflows(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as GithubTreeRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);

    const credential = req.driftwatchSession?.credential;
    const data = await analyzeWorkflows(owner, repo, credential);

    const response: WorkflowAnalysisResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
