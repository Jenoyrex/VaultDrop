export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  /**
   * Specifically for "your bearer token itself is missing, malformed, or
   * expired" — distinct from `unauthorized()`, which also covers ordinary
   * wrong-credential responses (e.g. a bad login password, or a wrong
   * current password during account password change). The client uses
   * this distinct code to trigger a global session-expired flow; it must
   * only ever come from token verification itself, never from a
   * route-level credential check.
   */
  static invalidToken(message = "Invalid or missing access token"): AppError {
    return new AppError(401, "INVALID_TOKEN", message);
  }

  static forbidden(message = "Forbidden"): AppError {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found"): AppError {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string): AppError {
    return new AppError(409, "CONFLICT", message);
  }
}
