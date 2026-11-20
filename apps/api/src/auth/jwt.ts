import {
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from "jose";

const ALG = "RS256";

export interface TokenServiceOptions {
  /** PEM-encoded PKCS#8 private key. Only this service can sign. */
  privateKeyPem: string;
  /** PEM-encoded SPKI public key. Anyone holding it can verify, not sign. */
  publicKeyPem: string;
  issuer?: string;
  audience?: string;
  /** Access token lifetime, in jose's format ("15m", "1h", ...). */
  accessTokenTtl?: string;
}

export interface AccessTokenClaims {
  /** The user id. Roles are deliberately NOT in the token — they're checked per request. */
  userId: string;
}

export type TokenService = Awaited<ReturnType<typeof createTokenService>>;

export async function createTokenService({
  privateKeyPem,
  publicKeyPem,
  issuer = "kw-api",
  audience = "kw",
  accessTokenTtl = "15m",
}: TokenServiceOptions) {
  const privateKey = await importPKCS8(privateKeyPem, ALG);
  const publicKey = await importSPKI(publicKeyPem, ALG, { extractable: true });

  // Key id = fingerprint of the public key. Lets us rotate keys later: verifiers
  // pick the matching public key by `kid` while old tokens are still in flight.
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);

  return {
    kid,

    /** Public key in JWK format, for a future /.well-known/jwks.json endpoint. */
    publicJwk: { ...publicJwk, kid, alg: ALG, use: "sig" },

    signAccessToken({ userId }: AccessTokenClaims): Promise<string> {
      return new SignJWT({})
        .setProtectedHeader({ alg: ALG, kid })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(accessTokenTtl)
        .sign(privateKey);
    },

    /** Throws if the token is malformed, tampered with, expired, or for another issuer/audience. */
    async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [ALG], // never let the token choose its own algorithm
        issuer,
        audience,
      });
      if (!payload.sub) throw new Error("token has no subject");
      return { userId: payload.sub };
    },
  };
}
