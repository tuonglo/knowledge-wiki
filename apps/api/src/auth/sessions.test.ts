import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrisma, resetDb } from "../test/db.js";
import {
  endSession,
  hashToken,
  InvalidSessionError,
  REFRESH_TOKEN_TTL_MS,
  rotateSession,
  startSession,
  TokenReuseError,
} from "./sessions.js";

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

let userId: string;
beforeEach(async () => {
  await resetDb(prisma);
  userId = (await prisma.user.create({ data: { email: "ann@example.com" } })).id;
});

const row = (token: string) => prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });

describe("rotateSession", () => {
  it("swaps the token for a new one in the same family and marks the old one used", async () => {
    const t1 = await startSession(prisma, userId);
    const t2 = await rotateSession(prisma, t1.token);

    expect(t2.token).not.toBe(t1.token);
    expect(t2.userId).toBe(userId);
    expect((await row(t1.token)).usedAt).not.toBeNull();
    expect((await row(t2.token)).familyId).toBe((await row(t1.token)).familyId);
  });

  it("keeps working along a chain of rotations", async () => {
    let s = await startSession(prisma, userId);
    for (let i = 0; i < 5; i++) s = await rotateSession(prisma, s.token);
    expect(await prisma.refreshToken.count()).toBe(6);
  });

  it("REUSE: replaying an old token revokes the whole family, including the newest token", async () => {
    const t1 = await startSession(prisma, userId);
    const t2 = await rotateSession(prisma, t1.token); // real user refreshed
    // attacker replays a stolen copy of t1:
    await expect(rotateSession(prisma, t1.token)).rejects.toThrow(TokenReuseError);
    // ...and now the real user's current token is dead too. Both must log in again.
    await expect(rotateSession(prisma, t2.token)).rejects.toThrow(/revoked/);
  });

  it("reuse in one session doesn't affect the user's other sessions (other devices)", async () => {
    const laptop = await startSession(prisma, userId);
    const phone = await startSession(prisma, userId);
    await rotateSession(prisma, laptop.token);
    await expect(rotateSession(prisma, laptop.token)).rejects.toThrow(TokenReuseError);

    await expect(rotateSession(prisma, phone.token)).resolves.toMatchObject({ userId });
  });

  it("RACE: two simultaneous refreshes with the same token → exactly one succeeds", async () => {
    const t1 = await startSession(prisma, userId);
    const results = await Promise.allSettled([rotateSession(prisma, t1.token), rotateSession(prisma, t1.token)]);

    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    // The loser is treated as reuse, so the family is revoked: no valid tokens remain.
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("rejects unknown and expired tokens", async () => {
    await expect(rotateSession(prisma, "made-up")).rejects.toThrow(InvalidSessionError);

    const t1 = await startSession(prisma, userId);
    const later = new Date(Date.now() + REFRESH_TOKEN_TTL_MS + 1000);
    await expect(rotateSession(prisma, t1.token, later)).rejects.toThrow(/expired/);
  });
});

describe("endSession", () => {
  it("logs out: the token (and its whole family) stops working", async () => {
    const t1 = await startSession(prisma, userId);
    const t2 = await rotateSession(prisma, t1.token);
    await endSession(prisma, t2.token);
    await expect(rotateSession(prisma, t2.token)).rejects.toThrow(/revoked/);
  });

  it("ignores unknown tokens", async () => {
    await expect(endSession(prisma, "made-up")).resolves.toBeUndefined();
  });
});
