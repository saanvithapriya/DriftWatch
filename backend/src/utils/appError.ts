/**
 * Error carrying an HTTP status and a message that is safe to send to clients.
 * Anything thrown that is not an AppError is treated as an internal error and
 * reported generically by the error handler.
 */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}
