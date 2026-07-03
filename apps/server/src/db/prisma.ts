import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __vaultdropPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__vaultdropPrisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env["NODE_ENV"] !== "production") {
  globalThis.__vaultdropPrisma = prisma;
}
