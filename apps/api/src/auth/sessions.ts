import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

/** How long a login lasts without activity before the user must sign in again. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The refresh token is missing, unknown, expired, or revoked. The user must log in. */
export class InvalidSessionError extends Error {
  constructor(reason: string) {
    super(`invalid session: ${reason}`);
    this.name = "InvalidSessionError";
  }
}

/** An already-used refresh token came back: someone has a copy. The family is now revoked. */
export class TokenReuseError extends InvalidSessionError {
  constructor(public readonly familyId: string) {
    super("refresh token reuse detected; session family revoked");
    this.name = "TokenReuseError";
  }
}

export interface Session {
  /** Raw token for the cookie. Never stored. */
  token: string;
  expiresAt: Date;
  userId: string;
}

/**
 * SHA-256 is enough here (unlike passwords): the token is 256 random bits,
 * so there's nothing to brute-force. Hashing just means a DB leak isn't a login leak.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(now: Date) {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  };
}

/** Start a new login session: a fresh refresh token in a NEW token family. */
export async function startSession(prisma: PrismaClient, userId: string, now = new Date()): Promise<Session> {
  const { token, expiresAt } = newToken(now);
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), familyId: randomUUID(), userId, expiresAt },
  });
  return { token, expiresAt, userId };
}

/**
 * Trade a refresh token for a new one in the same family (rotation).
 * Each token works exactly once. Presenting a used token revokes the whole family.
 */
export async function rotateSession(prisma: PrismaClient, rawToken: string, now = new Date()): Promise<Session> {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!current) throw new InvalidSessionError("unknown token");
  if (current.revokedAt) throw new InvalidSessionError("revoked");
  if (current.expiresAt <= now) throw new InvalidSessionError("expired");
  if (current.usedAt) {
    await revokeFamily(prisma, current.familyId, now);
    throw new TokenReuseError(current.familyId);
  }

  const next = newToken(now);
  const rotated = await prisma.$transaction(async (tx) => {
    // Atomic "claim": only succeeds if nobody used this token in the meantime.
    // Two concurrent refreshes with the same token → exactly one gets count = 1.
    const claim = await tx.refreshToken.updateMany({
      where: { id: current.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (claim.count === 0) return false;

    await tx.refreshToken.create({
      data: {
        tokenHash: hashToken(next.token),
        familyId: current.familyId,
        userId: current.userId,
        expiresAt: next.expiresAt,
      },
    });
    return true;
  });

  if (!rotated) {
    // Lost the race: another request used this token first. Same as reuse.
    await revokeFamily(prisma, current.familyId, now);
    throw new TokenReuseError(current.familyId);
  }
  return { ...next, userId: current.userId };
}

/** Log out: revoke every token in this session's family. Unknown tokens are ignored. */
export async function endSession(prisma: PrismaClient, rawToken: string, now = new Date()): Promise<void> {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (current) await revokeFamily(prisma, current.familyId, now);
}

async function revokeFamily(prisma: PrismaClient, familyId: string, now: Date) {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });
}
