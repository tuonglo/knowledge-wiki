import type { z } from "zod";

/**
 * Throw from a route to send an error response, e.g. `throw new HttpError(403, "forbidden")`.
 * The app's error handler turns it into `{ error: code }` with that status.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(`${status} ${code}`);
    this.name = "HttpError";
  }
}

/** Validate a request body with a zod schema, or throw 400 with what was wrong. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      400,
      "invalid_body",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
