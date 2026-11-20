import { UpdateDocumentBody } from "@kw/shared";
import { Router } from "express";
import type { TokenService } from "../auth/jwt.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseBody } from "../http.js";
import { authorizeDocument } from "../permissions.js";

const docFields = {
  id: true,
  title: true,
  parentId: true,
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** /documents/:id — every route checks the user's role on THIS document first. */
export function createDocumentsRouter({ prisma, tokens }: { prisma: PrismaClient; tokens: TokenService }): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  router.get("/:documentId", async (req, res) => {
    const role = await authorizeDocument(prisma, userIdOf(req), req.params.documentId, "view");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: req.params.documentId }, select: docFields });
    res.json({ ...doc, role }); // role lets the UI hide controls the user can't use
  });

  router.patch("/:documentId", async (req, res) => {
    await authorizeDocument(prisma, userIdOf(req), req.params.documentId, "edit");
    const { title } = parseBody(UpdateDocumentBody, req.body);
    const doc = await prisma.document.update({
      where: { id: req.params.documentId },
      data: { title },
      select: docFields,
    });
    res.json(doc);
  });

  // Deletes the page and (via ON DELETE CASCADE) all its sub-pages.
  router.delete("/:documentId", async (req, res) => {
    await authorizeDocument(prisma, userIdOf(req), req.params.documentId, "manage");
    await prisma.document.delete({ where: { id: req.params.documentId } });
    res.status(204).end();
  });

  return router;
}
