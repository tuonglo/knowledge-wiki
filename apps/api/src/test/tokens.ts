import { generateKeyPairSync } from "node:crypto";
import { createTokenService, type TokenService, type TokenServiceOptions } from "../auth/jwt.js";

/** A fresh RSA key pair, PEM-encoded the same way the gen:keys script does it. */
export function makeTestKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/** A token service with throwaway keys. */
export function createTestTokens(options: Partial<TokenServiceOptions> = {}): Promise<TokenService> {
  return createTokenService({ ...makeTestKeys(), ...options });
}
