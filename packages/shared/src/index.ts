import { z } from "zod";

/** Workspace roles, ordered from least to most privileged. Mirrors the Prisma `Role` enum. */
export const Role = z.enum(["VIEWER", "EDITOR", "OWNER"]);
export type Role = z.infer<typeof Role>;

const roleRank: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return roleRank[actual] >= roleRank[required];
}

export const HealthResponse = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.enum(["ok", "fail"])),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Payload published to the `doc.saved` Redis Stream (consumed by the Python indexer). */
export const DocSavedEvent = z.object({
  documentId: z.string(),
  workspaceId: z.string(),
  version: z.number().int().nonnegative(),
});
export type DocSavedEvent = z.infer<typeof DocSavedEvent>;

export const DOC_SAVED_STREAM = "doc.saved";
