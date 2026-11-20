import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrisma, resetDb } from "../test/db.js";
import type { OAuthProfile } from "./providers.js";
import { findOrCreateUser, UnverifiedEmailError } from "./users.js";

const prisma = createTestPrisma();

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

const github: OAuthProfile = {
  provider: "github",
  providerAccountId: "42",
  email: "ann@example.com",
  emailVerified: true,
  name: "Ann",
  avatarUrl: null,
};
const google: OAuthProfile = { ...github, provider: "google", providerAccountId: "g-7", name: "Ann G" };

describe("findOrCreateUser", () => {
  it("creates a user and their login on first sign-in", async () => {
    const user = await findOrCreateUser(prisma, github);
    expect(user).toMatchObject({ email: "ann@example.com", name: "Ann" });
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns the same user on later sign-ins, without duplicates", async () => {
    const first = await findOrCreateUser(prisma, github);
    const again = await findOrCreateUser(prisma, github);
    expect(again.id).toBe(first.id);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });

  it("finds the user by provider id even if their email changed", async () => {
    const first = await findOrCreateUser(prisma, github);
    const renamed = await findOrCreateUser(prisma, { ...github, email: "new@example.com" });
    expect(renamed.id).toBe(first.id);
  });

  it("links a second provider to the same user via verified email", async () => {
    const viaGithub = await findOrCreateUser(prisma, github);
    const viaGoogle = await findOrCreateUser(prisma, google);
    expect(viaGoogle.id).toBe(viaGithub.id);
    expect(await prisma.account.count({ where: { userId: viaGithub.id } })).toBe(2);
    expect(viaGoogle.name).toBe("Ann"); // linking doesn't overwrite the profile
  });

  it("refuses to link an UNVERIFIED email to an existing user (account takeover)", async () => {
    const victim = await findOrCreateUser(prisma, github);
    const attacker = { ...google, providerAccountId: "attacker", emailVerified: false };

    await expect(findOrCreateUser(prisma, attacker)).rejects.toThrow(UnverifiedEmailError);
    expect(await prisma.account.count({ where: { userId: victim.id } })).toBe(1);
  });

  it("refuses sign-up without any email", async () => {
    await expect(findOrCreateUser(prisma, { ...github, email: null })).rejects.toThrow(UnverifiedEmailError);
    expect(await prisma.user.count()).toBe(0);
  });
});
