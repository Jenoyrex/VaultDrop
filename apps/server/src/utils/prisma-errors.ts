import { Prisma } from "@prisma/client";

/**
 * True for Prisma's "Unique constraint failed" error (P2002). This is the
 * race-condition safety net behind every findFirst duplicate-name
 * pre-check in file.service.ts / folder.service.ts: two concurrent
 * requests can both pass the pre-check before either has committed, so
 * the DB's unique index — not the pre-check — is what actually prevents
 * a duplicate row from being written.
 */
export function isUniqueConstraintError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
