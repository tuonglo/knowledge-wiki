import { z } from "zod";

/** Empty strings (e.g. `GITHUB_CLIENT_ID=` in .env) count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/** A required env var holding base64-encoded PEM; decodes it and checks it's the right kind of key. */
function pemFromBase64(name: string, kind: "PRIVATE KEY" | "PUBLIC KEY") {
  return z
    .string({ error: `${name} is not set. Run: pnpm --filter @kw/api gen:keys` })
    .min(1, `${name} is empty. Run: pnpm --filter @kw/api gen:keys`)
    .transform((b64) => Buffer.from(b64, "base64").toString("utf8"))
    .refine((pem) => pem.includes(`-----BEGIN ${kind}-----`), `${name} doesn't decode to a PEM ${kind}`);
}

const Env = z.object({
  DATABASE_URL: z.string().default("postgresql://kw:kw@localhost:5432/kw"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  API_PORT: z.coerce.number().int().default(4000),
  /** The API's address AS THE BROWSER SEES IT (behind the web app's /api proxy). */
  API_URL: z.url().default("http://localhost:3000/api"),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),

  // Access-token signing keys: base64-encoded PEM (see `pnpm --filter @kw/api gen:keys`).
  // Required — the API can't log anyone in without them, so fail at startup, not at first login.
  JWT_PRIVATE_KEY: pemFromBase64("JWT_PRIVATE_KEY", "PRIVATE KEY"),
  JWT_PUBLIC_KEY: pemFromBase64("JWT_PUBLIC_KEY", "PUBLIC KEY"),

  // OAuth: a provider is enabled only when both its values are set.
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
});

export const env = Env.parse(process.env);
