import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { InvalidTokenError, signAccessToken, verifyAccessToken } from "./jwt.js";

const SECRET = "test-jwt-secret-at-least-32-characters-long";

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips a token signed by this module", () => {
    const token = signAccessToken({
      userId: "user-1",
      username: "alice",
      secret: SECRET,
      expiresIn: "15m"
    });

    const payload = verifyAccessToken(token, SECRET);

    expect(payload.sub).toBe("user-1");
    expect(payload.username).toBe("alice");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = signAccessToken({
      userId: "user-1",
      username: "alice",
      secret: "a-completely-different-secret-value-here",
      expiresIn: "15m"
    });

    expect(() => verifyAccessToken(token, SECRET)).toThrow(InvalidTokenError);
  });

  it("signs with HS256 explicitly", () => {
    const token = signAccessToken({
      userId: "user-1",
      username: "alice",
      secret: SECRET,
      expiresIn: "15m"
    });

    const header = JSON.parse(
      Buffer.from(token.split(".")[0] as string, "base64url").toString("utf8")
    ) as { alg: string };

    expect(header.alg).toBe("HS256");
  });

  /**
   * Regression test for explicit algorithm allow-listing: a token crafted
   * with a different algorithm than this app ever signs with must be
   * rejected by `verifyAccessToken`, even if it's otherwise well-formed
   * and would decode to a valid-looking payload. `none` is the classic
   * case (a token with no signature at all, historically exploitable in
   * JWT libraries that didn't enforce an algorithm allow-list) — jwt.sign
   * still requires an explicit opt-in for it, which is itself a signal
   * that accepting it should never happen by accident.
   */
  it("rejects a token signed with algorithm 'none' (alg-confusion / signature-stripping attack)", () => {
    const forgedToken = jwt.sign({ sub: "user-1", username: "alice" }, "", {
      algorithm: "none"
    });

    expect(() => verifyAccessToken(forgedToken, SECRET)).toThrow(InvalidTokenError);
  });

  it("rejects a token signed with HS384 even though it uses the same correct secret", () => {
    const forgedToken = jwt.sign({ sub: "user-1", username: "alice" }, SECRET, {
      algorithm: "HS384"
    });

    expect(() => verifyAccessToken(forgedToken, SECRET)).toThrow(InvalidTokenError);
  });
});
