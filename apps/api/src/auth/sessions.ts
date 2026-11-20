import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

/** How long a login lasts without activity before the user must sign in again. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * SHA-256 is enough here (unlike passwords): the token is 256 random bits,
 * so there's nothing to brute-force. Hashing just means a DB leak isn't a login leak.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Start a new login session: a fresh refresh token in a new token family.
 * Returns the RAW token (for the cookie). Only its hash is stored.
 */
export async function startSession(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), familyId: randomUUID(), userId, expiresAt },
  });
  return { token, expiresAt };
}
