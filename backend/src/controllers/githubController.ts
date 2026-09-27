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

    // The controller is where identity lives. It resolves the credential from
    // the session and hands it down; the service never looks at the request.
    // A client cannot supply its own credential: only the session provides one.
    const credential = req.driftwatchSession?.credential;

    const data = await fetchRepositoryTree(owner, repo, credential);

    const response: GithubTreeSuccessResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
