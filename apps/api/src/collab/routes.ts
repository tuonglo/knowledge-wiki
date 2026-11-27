import { CreateCollabTicketBody } from "@kw/shared";
import { Router } from "express";
import type { TokenService } from "../auth/jwt.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseBody } from "../http.js";
import { authorizeDocument } from "../permissions.js";
import { TICKET_TTL_SECONDS, type TicketStore } from "./tickets.js";

/** /collab/tickets: the HTTP half of opening a collaboration WebSocket. */
export function createCollabRouter({
  prisma,
  tokens,
  tickets,
}: {
  prisma: PrismaClient;
  tokens: TokenService;
  tickets: TicketStore;
}): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  router.post("/tickets", async (req, res) => {
    const userId = userIdOf(req);
    const { documentId } = parseBody(CreateCollabTicketBody, req.body);
    // Only for pages you can at least view (404 hides pages you can't).
    await authorizeDocument(prisma, userId, documentId, "view");
    const ticket = await tickets.issue({ userId, documentId });
    res.status(201).json({ ticket, expiresIn: TICKET_TTL_SECONDS });
  });

  return router;
}
