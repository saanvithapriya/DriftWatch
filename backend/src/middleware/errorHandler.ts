import type { NextFunction, Request, Response } from "express";

// Minimal foundation only — centralized error handling logic will be
// expanded in a later phase.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
