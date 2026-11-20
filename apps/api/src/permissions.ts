/**
 * Authorization: "may this user do X?" (→ 403 if not).
 *
 * Document rules live in ONE place — the `kw_document_roles` SQL function
 * (see prisma/migrations/*_permission_functions). This file only calls it,
 * so the Node API and the Python AI service can never disagree.
 */
import { type DocumentAction, Role, roleAllows, roleAtLeast } from "@kw/shared";
import type { PrismaClient } from "./generated/prisma/client.js";
import { HttpError } from "./http.js";

/** The user's effective role on a document, or null for no access (or no such document). */
export async function getDocumentRole(prisma: PrismaClient, userId: string, documentId: string): Promise<Role | null> {
  const rows = await prisma.$queryRaw<{ role: string }[]>`
    SELECT role::text FROM kw_document_roles(${userId}) WHERE document_id = ${documentId}`;
  return rows[0] ? Role.parse(rows[0].role) : null;
}

export async function canAccess(
  prisma: PrismaClient,
  userId: string,
  documentId: string,
  action: DocumentAction,
): Promise<boolean> {
  return roleAllows(await getDocumentRole(prisma, userId, documentId), action);
}

/** Every document the user can see, with their role on each. */
export async function listAccessibleDocuments(
  prisma: PrismaClient,
  userId: string,
): Promise<{ documentId: string; role: Role }[]> {
  const rows = await prisma.$queryRaw<{ document_id: string; role: string }[]>`
    SELECT document_id, role::text FROM kw_document_roles(${userId})`;
  return rows.map((r) => ({ documentId: r.document_id, role: Role.parse(r.role) }));
}

/**
 * The user's role in a workspace itself (membership only — document grants
 * don't make you a workspace member). Used for workspace-level actions:
 * inviting people (OWNER), creating top-level pages (EDITOR).
 */
export async function getWorkspaceRole(prisma: PrismaClient, userId: string, workspaceId: string): Promise<Role | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

// ---- route guards: throw the right HTTP error, or return the user's role ----
//
// 404 when the user can't see the thing at all — a 403 would confirm it EXISTS
//     (IDs leak through URLs, logs, screenshots). Same trick GitHub uses for private repos.
// 403 when they can see it but aren't allowed this action (e.g. a viewer editing).

export async function authorizeDocument(
  prisma: PrismaClient,
  userId: string,
  documentId: string,
  action: DocumentAction,
): Promise<Role> {
  const role = await getDocumentRole(prisma, userId, documentId);
  if (!role) throw new HttpError(404, "document_not_found");
  if (!roleAllows(role, action)) throw new HttpError(403, "forbidden");
  return role;
}

export async function authorizeWorkspace(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
  minRole: Role,
): Promise<Role> {
  const role = await getWorkspaceRole(prisma, userId, workspaceId);
  if (!role) throw new HttpError(404, "workspace_not_found");
  if (!roleAtLeast(role, minRole)) throw new HttpError(403, "forbidden");
  return role;
}
