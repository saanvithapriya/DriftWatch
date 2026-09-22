import type { NextFunction, Request, Response } from "express";
import { fetchRepositoryTree } from "../services/githubService.js";
import type {
  GithubTreeRequestBody,
  GithubTreeSuccessResponse,
} from "../types/github.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

export async function postGithubTree(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as GithubTreeRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);

    const data = await fetchRepositoryTree(owner, repo);

    const response: GithubTreeSuccessResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
