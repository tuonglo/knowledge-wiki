import { z } from "zod";

/** Empty strings (e.g. `GITHUB_CLIENT_ID=` in .env) count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const Env = z.object({
  DATABASE_URL: z.string().default("postgresql://kw:kw@localhost:5432/kw"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  API_PORT: z.coerce.number().int().default(4000),
  API_URL: z.url().default("http://localhost:4000"),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),

  // OAuth: a provider is enabled only when both its values are set.
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
});

export const env = Env.parse(process.env);
