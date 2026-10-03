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

/**
 * Patterns for anything credential-shaped. GitHub token prefixes cover
 * personal (ghp_), user-to-server (ghu_), server-to-server (ghs_), OAuth
 * (gho_) and refresh (ghr_) tokens.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{10,}/g,
  /(?:bearer|token)\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
];

function redact(text: string): string {
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

/**
 * Builds a log line from an error without ever serializing the error object.
 *
 * Octokit's errors carry the originating request, including its headers, so
 * logging the object wholesale risks writing an Authorization header into the
 * server log. Only the name, message and stack are taken, and those are
 * redacted as a second line of defence.
 */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const statusPart = typeof status === "number" ? ` (status ${status})` : "";
    const stack = typeof error.stack === "string" ? `\n${error.stack}` : "";
    return redact(`${error.name}: ${error.message}${statusPart}${stack}`);
  }

  if (typeof error === "string") return redact(error);
  return `Non-error thrown: ${redact(Object.prototype.toString.call(error))}`;
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
          : clientError.status === 413
            ? "Request body is too large"
            : "Invalid request",
    });
    return;
  }

  // Anything else is unexpected: log it server-side, return nothing specific.
  // The error object itself is never logged — see describeErrorForLog.
  console.error(describeErrorForLog(err));
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
