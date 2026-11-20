import { Router } from "express";
import type { TokenService } from "../auth/jwt.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** GET /me — the logged-in user's profile. The first protected route. */
export function createMeRouter({ prisma, tokens }: { prisma: PrismaClient; tokens: TokenService }): Router {
  const router = Router();
  router.use(requireAuth(tokens)); // every route in this router needs a valid token

  router.get("/", async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: userIdOf(req) },
      // Pick fields explicitly: never send whole DB rows to clients by accident.
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
    // A valid token for a user who no longer exists (deleted since it was issued).
    if (!user) return void res.status(401).json({ error: "unauthenticated" });
    res.json(user);
  });

  return router;
}
