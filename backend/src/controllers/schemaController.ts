import type { NextFunction, Request, Response } from "express";
import { analyzeSchema } from "../services/schemaService.js";
import type { SchemaAnalysisResponse, SchemaRequestBody } from "../types/schema.js";
import type { GithubTreeRequestBody } from "../types/github.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

/**
 * POST /api/github/schema
 *
 * Reuses Phase 1's URL validation and Phase 3's session handling verbatim,
 * exactly like every other analysis endpoint.
 */
export async function postGithubSchema(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as (GithubTreeRequestBody & SchemaRequestBody) | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);

    const credential = req.driftwatchSession?.credential;
    const data = await analyzeSchema(owner, repo, credential);

    const response: SchemaAnalysisResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
