import { z } from "zod";

/** Workspace roles, ordered from least to most privileged. Mirrors the Prisma `Role` enum. */
export const Role = z.enum(["VIEWER", "EDITOR", "OWNER"]);
export type Role = z.infer<typeof Role>;

const roleRank: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return roleRank[actual] >= roleRank[required];
}

/** Things a user can do to a document. */
export const DocumentAction = z.enum(["view", "edit", "manage"]);
export type DocumentAction = z.infer<typeof DocumentAction>;

/**
 * Minimum role for each action. The API enforces this; the web app uses the same
 * table only to hide buttons (hiding is UX, never security).
 */
export const MIN_ROLE_FOR: Record<DocumentAction, Role> = {
  view: "VIEWER",
  edit: "EDITOR",
  manage: "OWNER", // delete, share
};

/** `role` may be null (no access at all). */
export function roleAllows(role: Role | null, action: DocumentAction): boolean {
  return role !== null && roleAtLeast(role, MIN_ROLE_FOR[action]);
}

export const HealthResponse = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.enum(["ok", "fail"])),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---- API responses (the web app validates what it receives) ----

export const RefreshResponse = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const Me = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

// ---- API request bodies (validated by the API, reusable by web forms) ----

export const CreateWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const AddMemberBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: Role.default("VIEWER"),
});
export type AddMemberBody = z.infer<typeof AddMemberBody>;

export const UpdateMemberBody = z.object({ role: Role });
export type UpdateMemberBody = z.infer<typeof UpdateMemberBody>;

export const CreateDocumentBody = z.object({
  title: z.string().trim().min(1).max(200).default("Untitled"),
  /** Create as a sub-page of this document (same workspace). Omit for a top-level page. */
  parentId: z.string().min(1).optional(),
});
export type CreateDocumentBody = z.infer<typeof CreateDocumentBody>;

export const UpdateDocumentBody = z.object({
  title: z.string().trim().min(1).max(200),
});
export type UpdateDocumentBody = z.infer<typeof UpdateDocumentBody>;

/** Payload published to the `doc.saved` Redis Stream (consumed by the Python indexer). */
export const DocSavedEvent = z.object({
  documentId: z.string(),
  workspaceId: z.string(),
  version: z.number().int().nonnegative(),
});
export type DocSavedEvent = z.infer<typeof DocSavedEvent>;

export const DOC_SAVED_STREAM = "doc.saved";
