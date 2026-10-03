import type { NextFunction, Request, Response } from "express";
import { analyzeDependencies } from "../services/dependencyService.js";
import type { DependencyAnalysisResponse } from "../types/dependencies.js";
import type { GithubTreeRequestBody } from "../types/github.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

/**
 * POST /api/github/dependencies
 *
 * Reuses Phase 1's URL validation and Phase 3's session handling verbatim:
 * identity is resolved here and handed down, exactly as the tree endpoint
 * does.
 */
export async function postGithubDependencies(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as GithubTreeRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);

    const credential = req.driftwatchSession?.credential;
    const data = await analyzeDependencies(owner, repo, credential);

    const response: DependencyAnalysisResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
