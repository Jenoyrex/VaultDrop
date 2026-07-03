import argon2 from "argon2";

/**
 * Argon2id hashing tuned for an interactive web login path.
 * Parameters follow OWASP's current minimum recommendation for Argon2id.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1
};

export async function hashPassword(plainTextPassword: string): Promise<string> {
  if (plainTextPassword.length === 0) {
    throw new Error("Password must not be empty");
  }
  return argon2.hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plainTextPassword: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch {
    // Malformed hash or internal verify error: treat as non-match rather
    // than throwing, so callers always get a clean boolean.
    return false;
  }
}
