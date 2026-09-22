import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError.js";

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

  // Anything else is unexpected: log it server-side, return nothing specific.
  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
