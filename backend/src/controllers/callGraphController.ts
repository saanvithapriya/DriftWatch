import type { NextFunction, Request, Response } from "express";
import { analyzeCallGraph } from "../services/callGraphService.js";
import type { CallGraphAnalysisResponse, CallGraphRequestBody } from "../types/callGraph.js";
import type { GithubTreeRequestBody } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

const MAX_ENTRY_POINT_LENGTH = 500;

function parseEntryPoint(body: CallGraphRequestBody | undefined): string | undefined {
  const raw = body?.entryPoint;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_ENTRY_POINT_LENGTH) {
    throw new AppError(400, "Invalid entry point");
  }
  return raw;
}

/**
 * POST /api/github/call-graph
 *
 * Reuses Phase 1's URL validation and Phase 3's session handling verbatim,
 * exactly as the tree, dependency and workflow endpoints do.
 */
export async function postGithubCallGraph(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as (GithubTreeRequestBody & CallGraphRequestBody) | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const entryPoint = parseEntryPoint(body);

    const credential = req.driftwatchSession?.credential;
    const data = await analyzeCallGraph(owner, repo, entryPoint, credential);

    const response: CallGraphAnalysisResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
