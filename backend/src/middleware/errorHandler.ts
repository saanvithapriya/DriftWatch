import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError.js";

/**
 * Describes a request the client got wrong, as reported by Express's body
 * parser: an unparseable JSON body, an oversized payload, an unsupported
 * charset. Those carry a 4xx status and `expose: true`, meaning the failure is
 * safe to acknowledge to the caller.
 */
interface ClientRequestError {
  status: number;
  type?: string;
}

function asClientRequestError(err: unknown): ClientRequestError | null {
  if (typeof err !== "object" || err === null) return null;

  const candidate = err as Record<string, unknown>;
  if (candidate.expose !== true) return null;

  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;

  if (status === undefined || status < 400 || status >= 500) return null;

  return {
    status,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Expected, client-facing failures carry their own status and a message that
  // is safe to expose.
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // A malformed request body is the caller's mistake, so it must not be
  // reported as a server failure. The parser's own message is replaced with a
  // fixed one so nothing internal leaks.
  const clientError = asClientRequestError(err);
  if (clientError !== null) {
    res.status(clientError.status).json({
      success: false,
      message:
        clientError.type === "entity.parse.failed"
          ? "Malformed JSON in request body"
          : "Invalid request",
    });
    return;
  }

  // Anything else is unexpected: log it server-side, return nothing specific.
  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
