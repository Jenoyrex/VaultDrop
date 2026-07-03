import { loadServerEnv } from "@vaultdrop/config";
import { prisma } from "./db/prisma.js";
import { createStorageAdapter } from "./storage/storage-factory.js";
import { createApp } from "./app.js";

const env = loadServerEnv();
const storage = createStorageAdapter(env);
const app = createApp(prisma, env, storage);

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`VaultDrop server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down gracefully`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
