import jwt from "jsonwebtoken";
import type { AccessTokenPayload } from "@vaultdrop/types";

export interface SignAccessTokenInput {
  userId: string;
  username: string;
  /** Current `User.tokenVersion`; see `AccessTokenPayload.ver`. */
  tokenVersion: number;
  secret: string;
  expiresIn: string;
}

export function signAccessToken(input: SignAccessTokenInput): string {
  const payload: Pick<AccessTokenPayload, "sub" | "username" | "ver"> = {
    sub: input.userId,
    username: input.username,
    ver: input.tokenVersion
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

/**
 * Verifies Netlify's signed-proxy header (x-nf-sign): an HS256 JWS that
 * Netlify adds to every proxied request when the redirect rule has
 * `signed = "<ENV VAR>"`. Checks the signature, expiry, and that Netlify
 * issued it. Returns false instead of throwing.
 */
export function isValidNetlifyProxySignature(token: string, secret: string): boolean {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: "netlify" });
    return typeof decoded !== "string";
  } catch {
    return false;
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
    if (
      typeof decoded.sub !== "string" ||
      typeof decoded["username"] !== "string" ||
      !Number.isInteger(decoded["ver"])
    ) {
      throw new InvalidTokenError();
    }
    return {
      sub: decoded.sub,
      username: decoded["username"] as string,
      ver: decoded["ver"] as number,
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
