import { AddMemberBody, CreateDocumentBody, CreateWorkspaceBody, UpdateMemberBody } from "@kw/shared";
import { Router } from "express";
import type { TokenService } from "../auth/jwt.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import type { PrismaClient, Role } from "../generated/prisma/client.js";
import { HttpError, parseBody } from "../http.js";
import { authorizeDocument, authorizeWorkspace, getWorkspaceRole } from "../permissions.js";

interface Deps {
  prisma: PrismaClient;
  tokens: TokenService;
}

const memberFields = {
  role: true,
  user: { select: { id: true, email: true, name: true, avatarUrl: true } },
} as const;

export function createWorkspacesRouter({ prisma, tokens }: Deps): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  // ---- workspaces ----

  // Create a workspace; the creator becomes its OWNER (both rows or neither).
  router.post("/", async (req, res) => {
    const { name } = parseBody(CreateWorkspaceBody, req.body);
    const workspace = await prisma.workspace.create({
      data: { name, memberships: { create: { userId: userIdOf(req), role: "OWNER" } } },
      select: { id: true, name: true, createdAt: true },
    });
    res.status(201).json({ ...workspace, role: "OWNER" });
  });

  // The workspaces I'm a member of, with my role in each.
  router.get("/", async (req, res) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: userIdOf(req) },
      select: { role: true, workspace: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { workspace: { createdAt: "asc" } },
    });
    res.json(memberships.map((m) => ({ ...m.workspace, role: m.role })));
  });

  // ---- members ----

  router.get("/:workspaceId/members", async (req, res) => {
    const { workspaceId } = req.params;
    await authorizeWorkspace(prisma, userIdOf(req), workspaceId, "VIEWER");
    const members = await prisma.membership.findMany({
      where: { workspaceId },
      select: memberFields,
      orderBy: { createdAt: "asc" },
    });
    res.json(members.map((m) => ({ ...m.user, role: m.role })));
  });

  // Invite: add an existing user (they must have logged in once) by email. Owners only.
  router.post("/:workspaceId/members", async (req, res) => {
    const { workspaceId } = req.params;
    await authorizeWorkspace(prisma, userIdOf(req), workspaceId, "OWNER");
    const { email, role } = parseBody(AddMemberBody, req.body);

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new HttpError(404, "user_not_found");
    if (await getWorkspaceRole(prisma, user.id, workspaceId)) throw new HttpError(409, "already_member");

    const member = await prisma.membership.create({
      data: { userId: user.id, workspaceId, role },
      select: memberFields,
    });
    res.status(201).json({ ...member.user, role: member.role });
  });

  // Change someone's role. Owners only.
  router.patch("/:workspaceId/members/:userId", async (req, res) => {
    const { workspaceId, userId } = req.params;
    await authorizeWorkspace(prisma, userIdOf(req), workspaceId, "OWNER");
    const { role } = parseBody(UpdateMemberBody, req.body);

    await changeMembership(prisma, workspaceId, userId, role);
    res.json({ userId, role });
  });

  // Remove someone (owners), or leave yourself (anyone).
  router.delete("/:workspaceId/members/:userId", async (req, res) => {
    const { workspaceId, userId } = req.params;
    const me = userIdOf(req);
    await authorizeWorkspace(prisma, me, workspaceId, userId === me ? "VIEWER" : "OWNER");

    await changeMembership(prisma, workspaceId, userId, null);
    res.status(204).end();
  });

  // ---- documents in a workspace ----

  // The page tree for the sidebar: only pages this user can see, with their role on each.
  router.get("/:workspaceId/documents", async (req, res) => {
    const { workspaceId } = req.params;
    const me = userIdOf(req);
    const docs = await prisma.$queryRaw<{ id: string; title: string; parentId: string | null; role: Role }[]>`
      SELECT d.id, d.title, d."parentId", r.role::text AS role
      FROM kw_document_roles(${me}) r
      JOIN "Document" d ON d.id = r.document_id
      WHERE d."workspaceId" = ${workspaceId}
      ORDER BY d."createdAt"`;
    // Guests (page grants, no membership) still see their pages. Strangers get 404.
    if (docs.length === 0 && !(await getWorkspaceRole(prisma, me, workspaceId))) {
      throw new HttpError(404, "workspace_not_found");
    }
    res.json(docs);
  });

  // New page. Top-level needs workspace EDITOR; a sub-page needs edit on its parent.
  router.post("/:workspaceId/documents", async (req, res) => {
    const { workspaceId } = req.params;
    const me = userIdOf(req);
    const { title, parentId } = parseBody(CreateDocumentBody, req.body);

    if (parentId) {
      await authorizeDocument(prisma, me, parentId, "edit");
      const parent = await prisma.document.findUniqueOrThrow({ where: { id: parentId }, select: { workspaceId: true } });
      if (parent.workspaceId !== workspaceId) throw new HttpError(400, "parent_in_other_workspace");
    } else {
      await authorizeWorkspace(prisma, me, workspaceId, "EDITOR");
    }

    const doc = await prisma.document.create({
      data: { title, workspaceId, parentId, createdById: me },
      select: { id: true, title: true, parentId: true, workspaceId: true, createdAt: true, updatedAt: true },
    });
    res.status(201).json(doc);
  });

  return router;
}

/**
 * Set a member's role, or remove them (role = null), refusing to leave the
 * workspace without an OWNER.
 *
 * Runs in a transaction that LOCKS the owner rows first (SELECT … FOR UPDATE).
 * Without the lock, two owners demoting each other at the same moment could
 * both see "there's another owner" and both succeed → zero owners.
 *
 * `testHooks.afterOwnersRead` is a test seam: tests use it to hold transactions
 * at the dangerous moment and prove the lock works. Unused in production.
 */
export async function changeMembership(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  role: Role | null,
  testHooks: { afterOwnersRead?: () => Promise<void> } = {},
) {
  await prisma.$transaction(async (tx) => {
    const owners = await tx.$queryRaw<{ userId: string }[]>`
      SELECT "userId" FROM "Membership"
      WHERE "workspaceId" = ${workspaceId} AND role = 'OWNER'
      FOR UPDATE`;
    await testHooks.afterOwnersRead?.();

    const target = await tx.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
    if (!target) throw new HttpError(404, "member_not_found");

    const losesOwner = target.role === "OWNER" && role !== "OWNER";
    if (losesOwner && owners.length <= 1) throw new HttpError(409, "last_owner");

    if (role === null) {
      await tx.membership.delete({ where: { userId_workspaceId: { userId, workspaceId } } });
    } else {
      await tx.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role } });
    }
  });
}
