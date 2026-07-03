import type { AccessTokenPayload } from "@vaultdrop/types";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export {};
