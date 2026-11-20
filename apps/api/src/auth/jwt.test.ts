import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTokenService, type TokenService } from "./jwt.js";

/** Throwaway RSA key pair, PEM-encoded the same way the gen:keys script does it. */
function makeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

describe("token service", () => {
  let tokens: TokenService;
  const keys = makeKeys();

  beforeAll(async () => {
    tokens = await createTokenService(keys);
  });

  afterEach(() => vi.useRealTimers());

  it("round-trips: a signed token verifies back to the same user", async () => {
    const token = await tokens.signAccessToken({ userId: "user_1" });
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ userId: "user_1" });
  });

  it("puts only identity in the payload, not roles", async () => {
    const payload = decodeJwt(await tokens.signAccessToken({ userId: "user_1" }));
    expect(Object.keys(payload).sort()).toEqual(["aud", "exp", "iat", "iss", "sub"]);
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });

  it("labels the token with the key id", async () => {
    const header = decodeProtectedHeader(await tokens.signAccessToken({ userId: "u" }));
    expect(header).toEqual({ alg: "RS256", kid: tokens.kid });
  });

  it("rejects an expired token", async () => {
    const token = await tokens.signAccessToken({ userId: "user_1" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000); // 16 minutes later
    await expect(tokens.verifyAccessToken(token)).rejects.toThrow(/exp/);
  });

  it("rejects a token whose payload was edited", async () => {
    const token = await tokens.signAccessToken({ userId: "user_1" });
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...decodeJwt(token), sub: "admin" }),
    ).toString("base64url");
    await expect(
      tokens.verifyAccessToken(`${header}.${forgedPayload}.${signature}`),
    ).rejects.toThrow(/signature/);
  });

  it("rejects a token signed by a different key", async () => {
    const attacker = await createTokenService(makeKeys());
    const token = await attacker.signAccessToken({ userId: "user_1" });
    await expect(tokens.verifyAccessToken(token)).rejects.toThrow(/signature/);
  });

  it("rejects a token meant for a different audience", async () => {
    const other = await createTokenService({ ...keys, audience: "some-other-app" });
    const token = await other.signAccessToken({ userId: "user_1" });
    await expect(tokens.verifyAccessToken(token)).rejects.toThrow(/aud/);
  });

  it('rejects an unsigned token (alg: "none" attack)', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const token = `${enc({ alg: "none" })}.${enc({ sub: "admin", iss: "kw-api", aud: "kw", iat: now, exp: now + 60 })}.`;
    await expect(tokens.verifyAccessToken(token)).rejects.toThrow();
  });
});
