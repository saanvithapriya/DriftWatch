import type { NextFunction, Request, Response } from "express";
import {
  compareCommits,
  fetchCommitDetail,
  fetchCommitHistory,
  fetchFileHistory,
  fetchHistoryStats,
  validateGitRef,
  validateHistoryQuery,
} from "../services/historyService.js";
import type {
  CommitRequestBody,
  CommitResponse,
  CompareRequestBody,
  CompareResponse,
  FileHistoryRequestBody,
  FileHistoryResponse,
  HistoryRequestBody,
  HistoryResponse,
  HistoryStatsResponse,
} from "../types/history.js";
import { AppError } from "../utils/appError.js";
import { parseGithubRepositoryUrlOrThrow } from "../utils/githubUrl.js";

/**
 * Phase 7 history/commit/compare/file-history/history-stats controllers.
 *
 * Reuse Phase 1's URL validation and Phase 3's session handling verbatim,
 * exactly like every analysis endpoint before them: identity is resolved
 * from the session and handed down, never accepted from the client.
 */

export async function postGithubHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as HistoryRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const query = validateHistoryQuery(body ?? {});

    const credential = req.driftwatchSession?.credential;
    const data = await fetchCommitHistory(owner, repo, query, credential);

    const response: HistoryResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function postGithubCommit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as CommitRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const sha = validateGitRef(body?.sha, "sha");

    const credential = req.driftwatchSession?.credential;
    const data = await fetchCommitDetail(owner, repo, sha, credential);

    const response: CommitResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function postGithubCompare(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as CompareRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const base = validateGitRef(body?.base, "base");
    const head = validateGitRef(body?.head, "head");

    const credential = req.driftwatchSession?.credential;
    const data = await compareCommits(owner, repo, base, head, credential);

    const response: CompareResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

const MAX_PATH_LENGTH = 1000;

export async function postGithubFileHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as FileHistoryRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);

    const rawPath = body?.path;
    if (typeof rawPath !== "string" || rawPath === "" || rawPath.length > MAX_PATH_LENGTH) {
      throw new AppError(400, "path is required");
    }

    const query = validateHistoryQuery({ page: body?.page, perPage: body?.perPage });

    const credential = req.driftwatchSession?.credential;
    const data = await fetchFileHistory(owner, repo, rawPath, query.page, query.perPage, credential);

    const response: FileHistoryResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function postGithubHistoryStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as HistoryRequestBody | undefined;
    const { owner, repo } = parseGithubRepositoryUrlOrThrow(body?.url);
    const query = validateHistoryQuery(body ?? {});

    const credential = req.driftwatchSession?.credential;
    const data = await fetchHistoryStats(owner, repo, query, credential);

    const response: HistoryStatsResponse = { success: true, data };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
