import jwt from "jsonwebtoken";
import type { AccessTokenPayload } from "@vaultdrop/types";

export interface SignAccessTokenInput {
  userId: string;
  username: string;
  secret: string;
  expiresIn: string;
}

export function signAccessToken(input: SignAccessTokenInput): string {
  const payload: Pick<AccessTokenPayload, "sub" | "username"> = {
    sub: input.userId,
    username: input.username
  };
  return jwt.sign(payload, input.secret, {
    expiresIn: input.expiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256"
  });
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired access token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  try {
    // Explicit allow-list rather than relying on jsonwebtoken's own
    // default inference (which — for a string secret — already restricts
    // to the HS256/384/512 family, so this doesn't change today's actual
    // behavior). Being explicit here means that guarantee no longer
    // depends on library-default behavior/version, and it's the only
    // algorithm this app's tokens are ever signed with (see
    // `signAccessToken` above).
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") {
      throw new InvalidTokenError();
    }
    if (typeof decoded.sub !== "string" || typeof decoded["username"] !== "string") {
      throw new InvalidTokenError();
    }
    return {
      sub: decoded.sub,
      username: decoded["username"] as string,
      iat: typeof decoded.iat === "number" ? decoded.iat : undefined,
      exp: typeof decoded.exp === "number" ? decoded.exp : undefined
    };
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw error;
    }
    throw new InvalidTokenError();
  }
}
