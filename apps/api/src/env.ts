import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgresql://kw:kw@localhost:5432/kw"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

export const env = Env.parse(process.env);
