import type { PrismaClient, User } from "../generated/prisma/client.js";
import type { OAuthProfile } from "./providers.js";

/** Thrown when a provider can't vouch for the user's email. We need one to log in. */
export class UnverifiedEmailError extends Error {
  constructor(provider: string) {
    super(`${provider} did not provide a verified email address`);
    this.name = "UnverifiedEmailError";
  }
}

/**
 * Resolve a provider login to one of our users:
 *   1. Known (provider, providerAccountId)  → that user.
 *   2. Unknown login, verified email matches an existing user → link the login to them.
 *   3. Otherwise → create the user and the login.
 *
 * Steps 2–3 require a VERIFIED email. Linking on an unverified one would let anyone
 * who adds your address to their provider account log in as you.
 */
export async function findOrCreateUser(prisma: PrismaClient, profile: OAuthProfile): Promise<User> {
  const { provider, providerAccountId } = profile;

  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (account) return account.user;

  if (!profile.email || !profile.emailVerified) throw new UnverifiedEmailError(provider);
  const email = profile.email;

  // Transaction: the user and their login are created together or not at all.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: {}, // existing user: link only, don't overwrite their profile
      create: { email, name: profile.name, avatarUrl: profile.avatarUrl },
    });
    await tx.account.create({ data: { provider, providerAccountId, userId: user.id } });
    return user;
  });
}
