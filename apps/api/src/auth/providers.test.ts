import { describe, expect, it } from "vitest";
import { githubProfile, googleProfile } from "./providers.js";

const ghUser = { id: 42, login: "octo", name: null, avatar_url: "https://a/x.png" };

describe("githubProfile", () => {
  it("uses the primary verified email, lowercased", () => {
    const p = githubProfile(ghUser, [
      { email: "old@x.com", primary: false, verified: true },
      { email: "Me@Example.com", primary: true, verified: true },
    ]);
    expect(p).toMatchObject({
      provider: "github",
      providerAccountId: "42", // GitHub ids are numbers; we store strings
      email: "me@example.com",
      emailVerified: true,
      name: "octo", // falls back to login when name is unset
    });
  });

  it("marks the email unverified when the primary isn't verified", () => {
    const p = githubProfile(ghUser, [
      { email: "verified-but-not-primary@x.com", primary: false, verified: true },
      { email: "primary@x.com", primary: true, verified: false },
    ]);
    expect(p.email).toBe("primary@x.com");
    expect(p.emailVerified).toBe(false);
  });

  it("handles no emails at all", () => {
    expect(githubProfile(ghUser, [])).toMatchObject({ email: null, emailVerified: false });
  });
});

describe("googleProfile", () => {
  it("maps id-token claims", () => {
    expect(
      googleProfile({ sub: "g-1", email: "A@B.com", email_verified: true, name: "Ann", picture: "p" }),
    ).toEqual({
      provider: "google",
      providerAccountId: "g-1",
      email: "a@b.com",
      emailVerified: true,
      name: "Ann",
      avatarUrl: "p",
    });
  });

  it("treats a missing email_verified as unverified", () => {
    expect(googleProfile({ sub: "g-1", email: "a@b.com" }).emailVerified).toBe(false);
  });
});
