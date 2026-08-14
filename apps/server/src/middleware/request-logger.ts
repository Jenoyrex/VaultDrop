import type { NextFunction, Request, Response } from "express";

/**
 * Structured access + error logging, deliberately restricted to a fixed,
 * safe field set. Nothing here ever reads `req.body`, `req.headers`
 * (which would include `Authorization`/the bearer JWT), or any query
 * string (`req.query`/`req.originalUrl`/`req.url`) — `req.path` only,
 * which is the route pattern's matched path with no query component. This
 * matters concretely for this API: `POST /files/upload-encrypted` carries
 * the wrapped file key and encrypted name as query params, and recovery/
 * encryption routes carry ciphertext in request bodies — none of that may
 * ever reach a log line.
 */

interface SafeAccessLogEntry {
  type: "request";
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string;
  timestamp: string;
}

interface SafeErrorLogEntry {
  type: "error";
  method: string;
  path: string;
  userId?: string;
  errorName: string;
  errorMessage: string;
  timestamp: string;
}

/** Access-log middleware: one JSON line per request, logged after the
 * response finishes so the real status code and duration are known. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  // Captured now, not inside the `finish` handler below: once the request
  // descends into a mounted sub-router (e.g. `app.use("/auth", ...)`),
  // Express strips that prefix from `req.url`/`req.path` for the
  // sub-router's own view, and only restores it when the sub-router calls
  // `next()` back up the stack — which a route handler that sends a
  // response directly never does. Reading `req.path` later, from the
  // `finish` event, would see e.g. "/register" instead of "/auth/register".
  const path = req.path;
  const method = req.method;

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const entry: SafeAccessLogEntry = {
      type: "request",
      method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      timestamp: new Date().toISOString()
    };
    if (req.user) {
      entry.userId = req.user.sub;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  });

  next();
}

/**
 * Logs an unexpected (non-`AppError`, non-`ZodError`) server error with
 * only its name/message and the safe request fields above — never the
 * request that triggered it. Used by the global error handler in place of
 * a bare `console.error(error)`.
 */
export function logServerError(error: unknown, req: Request): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const entry: SafeErrorLogEntry = {
    type: "error",
    method: req.method,
    path: req.path,
    errorName: err.name,
    errorMessage: err.message,
    timestamp: new Date().toISOString()
  };
  if (req.user) {
    entry.userId = req.user.sub;
  }
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(entry));
}
