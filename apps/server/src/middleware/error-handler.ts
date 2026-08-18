import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error.js";
import { logServerError } from "./request-logger.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.flatten()
      }
    });
    return;
  }

  // `express.json({ limit: ... })` (mounted in app.ts) throws a plain
  // error — not an AppError — with `.type === "entity.too.large"` when a
  // request body exceeds that limit. Without this branch it would fall
  // through to the generic 500 below: a misleading status code for an
  // entirely expected, well-formed client mistake, and one that would
  // spam `logServerError`'s "unexpected error" log on every oversized
  // request. Checking the body-parser-specific `.type` (rather than only
  // `.status`/`.statusCode === 413`) avoids misclassifying some unrelated
  // future 413 from elsewhere in the stack as this specific, known case.
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    (error as { type?: unknown }).type === "entity.too.large"
  ) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the maximum allowed size"
      }
    });
    return;
  }

  logServerError(error, req);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
  });
};
