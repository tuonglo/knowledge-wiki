import { SaveContentBody, UpdateDocumentBody } from "@kw/shared";
import express, { type RequestHandler, Router } from "express";
import type { TokenService } from "../auth/jwt.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import { type DocEvents, noDocEvents } from "../events.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseBody } from "../http.js";
import { authorizeDocument } from "../permissions.js";
import { isValidYjsUpdate } from "../yjs.js";

/** Page content (base64 Yjs state ≤ ~4 MB + markdown) needs more than the global 100 kB. */
const CONTENT_BODY_LIMIT = "5mb";

const docFields = {
  id: true,
  title: true,
  parentId: true,
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** /documents/:id — every route checks the user's role on THIS document first. */
export function createDocumentsRouter({
  prisma,
  tokens,
  events = noDocEvents,
}: {
  prisma: PrismaClient;
  tokens: TokenService;
  events?: DocEvents;
}): Router {
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

  // ---- content ----

  router.get("/:documentId/content", async (req, res) => {
    const { documentId } = req.params;
    await authorizeDocument(prisma, userIdOf(req), documentId, "view");
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { content: true, markdown: true, version: true },
    });
    res.json({
      state: doc.content ? Buffer.from(doc.content).toString("base64") : null,
      markdown: doc.markdown,
      version: doc.version,
    });
  });

  /**
   * Save content. Optimistic concurrency: the client says which version it started from
   * (`baseVersion`). The UPDATE only matches if that's still the stored version, so check
   * and write are ONE atomic statement: two saves from the same base can't both win.
   * The loser gets 409 and must reload instead of silently overwriting newer content.
   */
  const canEdit: RequestHandler = async (req, _res, next) => {
    await authorizeDocument(prisma, userIdOf(req), String(req.params.documentId), "edit");
    next();
  };

  const saveContent: RequestHandler<{ documentId: string }> = async (req, res) => {
    const { documentId } = req.params;
    const { state, markdown, baseVersion } = parseBody(SaveContentBody, req.body);

    const bytes = Buffer.from(state, "base64");
    if (!isValidYjsUpdate(bytes)) throw new HttpError(400, "invalid_state");

    const { count } = await prisma.document.updateMany({
      where: { id: documentId, version: baseVersion },
      data: { content: bytes, markdown, version: { increment: 1 } },
    });
    if (count === 0) {
      const current = await prisma.document.findUnique({ where: { id: documentId }, select: { version: true } });
      if (!current) throw new HttpError(404, "document_not_found"); // deleted mid-request
      throw new HttpError(409, "version_conflict", { currentVersion: current.version });
    }

    const version = baseVersion + 1;
    const { workspaceId } = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { workspaceId: true } });
    // Best effort: the save already committed, so a Redis hiccup mustn't turn it into a 500.
    // A missed event only delays indexing; the indexer can reconcile by comparing versions.
    try {
      await events.docSaved({ documentId, workspaceId, version });
    } catch (err) {
      console.error("doc.saved publish failed", { documentId, version, err });
    }
    res.json({ version });
  };

  // Order matters: logged in (router.use above) → may edit THIS page → only then read up to 5 MB.
  router.put("/:documentId/content", canEdit, express.json({ limit: CONTENT_BODY_LIMIT }), saveContent);

  // Deletes the page and (via ON DELETE CASCADE) all its sub-pages.
  router.delete("/:documentId", async (req, res) => {
    await authorizeDocument(prisma, userIdOf(req), req.params.documentId, "manage");
    await prisma.document.delete({ where: { id: req.params.documentId } });
    res.status(204).end();
  });

  return router;
}
