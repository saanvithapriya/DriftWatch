import type { NextFunction, Request, Response } from "express";
import { analyzeImpact, clampImpactDepth } from "../services/impactService.js";
import { validateGitRef } from "../services/historyService.js";
import type { ImpactRequestBody, ImpactResponse } from "../types/history.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

/**
 * POST /api/github/impact
 *
 * Reuses Phase 1's URL validation and Phase 3's session handling verbatim.
 */
export async function postGithubImpact(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as ImpactRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const base = validateGitRef(body?.base, "base");
    const head = validateGitRef(body?.head, "head");
    const maxDepth = clampImpactDepth(body?.maxDepth);

    const credential = req.driftwatchSession?.credential;
    const data = await analyzeImpact(owner, repo, base, head, maxDepth, credential);

    const response: ImpactResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
