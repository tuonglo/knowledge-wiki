import { decodeIdToken, GitHub, Google } from "arctic";

export type ProviderName = "github" | "google";

/** What we need from any login provider, normalized to one shape. */
export interface OAuthProfile {
  provider: ProviderName;
  /** The user's stable id at the provider. Emails can change; this can't. */
  providerAccountId: string;
  email: string | null;
  /** Did the provider confirm the user owns this email? Gates account linking. */
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  name: ProviderName;
  /** Where to send the browser. `codeVerifier` is the PKCE secret (ignored by GitHub). */
  createAuthorizationUrl(state: string, codeVerifier: string): URL;
  /** Trade the one-time `code` from the callback for the user's profile. */
  fetchProfile(code: string, codeVerifier: string): Promise<OAuthProfile>;
}

// ---------- pure mapping functions (unit-tested) ----------

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}
export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export function githubProfile(user: GitHubUser, emails: GitHubEmail[]): OAuthProfile {
  // Only the primary email counts, and only if GitHub verified it.
  const primary = emails.find((e) => e.primary);
  return {
    provider: "github",
    providerAccountId: String(user.id),
    email: primary?.email.toLowerCase() ?? null,
    emailVerified: primary?.verified ?? false,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
  };
}

export interface GoogleIdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export function googleProfile(claims: GoogleIdClaims): OAuthProfile {
  return {
    provider: "google",
    providerAccountId: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    emailVerified: claims.email_verified === true,
    name: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
  };
}

// ---------- network layer ----------

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. http://localhost:4000 — callback becomes `${apiUrl}/auth/<name>/callback` */
  apiUrl: string;
}

async function githubGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "knowledge-wiki",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export function createGitHubProvider({ clientId, clientSecret, apiUrl }: ProviderConfig): OAuthProvider {
  const client = new GitHub(clientId, clientSecret, `${apiUrl}/auth/github/callback`);
  return {
    name: "github",
    createAuthorizationUrl: (state) => client.createAuthorizationURL(state, ["read:user", "user:email"]),
    async fetchProfile(code) {
      const tokens = await client.validateAuthorizationCode(code);
      const accessToken = tokens.accessToken();
      const [user, emails] = await Promise.all([
        githubGet<GitHubUser>("/user", accessToken),
        githubGet<GitHubEmail[]>("/user/emails", accessToken),
      ]);
      return githubProfile(user, emails);
    },
  };
}

export function createGoogleProvider({ clientId, clientSecret, apiUrl }: ProviderConfig): OAuthProvider {
  const client = new Google(clientId, clientSecret, `${apiUrl}/auth/google/callback`);
  return {
    name: "google",
    createAuthorizationUrl: (state, codeVerifier) =>
      client.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]),
    async fetchProfile(code, codeVerifier) {
      const tokens = await client.validateAuthorizationCode(code, codeVerifier);
      // Safe to decode without verifying the signature: we got it straight from
      // Google's token endpoint over TLS, not from the browser.
      return googleProfile(decodeIdToken(tokens.idToken()) as GoogleIdClaims);
    },
  };
}
