import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearerFor, createTestApp } from "../test/app.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import { createTestTokens } from "../test/tokens.js";
import { changeMembership } from "./workspaces.js";

const prisma = createTestPrisma();
let app: Express;
let as: (userId: string) => Promise<string>;

beforeAll(async () => {
  const tokens = await createTestTokens();
  app = createTestApp(prisma, tokens);
  as = bearerFor(tokens);
});
afterAll(() => prisma.$disconnect());

let olivia: string, vic: string, xena: string;
beforeEach(async () => {
  await resetDb(prisma);
  olivia = (await prisma.user.create({ data: { email: "olivia@example.com", name: "Olivia" } })).id;
  vic = (await prisma.user.create({ data: { email: "vic@example.com" } })).id;
  xena = (await prisma.user.create({ data: { email: "xena@example.com" } })).id;
});

/**
 * Returns a function that waits until `n` callers have arrived (or `timeoutMs` passes,
 * so a caller that's blocked elsewhere can't deadlock the test).
 */
function barrier(n: number, timeoutMs: number) {
  let arrived = 0;
  let releaseAll!: () => void;
  const allHere = new Promise<void>((resolve) => (releaseAll = resolve));
  return async () => {
    if (++arrived === n) releaseAll();
    await Promise.race([allHere, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  };
}

/** Olivia creates a workspace; returns its id. */
async function oliviasWorkspace() {
  const res = await request(app).post("/workspaces").set("Authorization", await as(olivia)).send({ name: "Acme" });
  return res.body.id as string;
}

describe("POST /workspaces", () => {
  it("creates the workspace and makes the creator its OWNER", async () => {
    const res = await request(app).post("/workspaces").set("Authorization", await as(olivia)).send({ name: "  Acme  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Acme", role: "OWNER" }); // trimmed
    const m = await prisma.membership.findFirstOrThrow({ where: { workspaceId: res.body.id } });
    expect(m).toMatchObject({ userId: olivia, role: "OWNER" });
  });

  it("400s with details on an invalid body", async () => {
    const res = await request(app).post("/workspaces").set("Authorization", await as(olivia)).send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(res.body.details[0].path).toBe("name");
  });

  it("400s on malformed JSON", async () => {
    const res = await request(app)
      .post("/workspaces")
      .set("Authorization", await as(olivia))
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_json");
  });

  it("401s when not logged in", async () => {
    expect((await request(app).post("/workspaces").send({ name: "Acme" })).status).toBe(401);
  });
});

describe("GET /workspaces", () => {
  it("lists only my workspaces, with my role", async () => {
    await oliviasWorkspace();
    const mine = await request(app).get("/workspaces").set("Authorization", await as(olivia));
    const theirs = await request(app).get("/workspaces").set("Authorization", await as(xena));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ name: "Acme", role: "OWNER" });
    expect(theirs.body).toEqual([]);
  });
});

describe("members", () => {
  it("owner invites an existing user by email (case-insensitive), defaulting to VIEWER", async () => {
    const ws = await oliviasWorkspace();
    const res = await request(app)
      .post(`/workspaces/${ws}/members`)
      .set("Authorization", await as(olivia))
      .send({ email: "VIC@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: vic, email: "vic@example.com", role: "VIEWER" });
  });

  it("404s inviting someone who has never logged in", async () => {
    const ws = await oliviasWorkspace();
    const res = await request(app)
      .post(`/workspaces/${ws}/members`)
      .set("Authorization", await as(olivia))
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
  });

  it("409s inviting someone who's already a member", async () => {
    const ws = await oliviasWorkspace();
    const invite = async () =>
      request(app).post(`/workspaces/${ws}/members`).set("Authorization", await as(olivia)).send({ email: "vic@example.com" });
    await invite();
    expect((await invite()).status).toBe(409);
  });

  it("only owners can invite: a viewer gets 403", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "VIEWER" } });

    const res = await request(app)
      .post(`/workspaces/${ws}/members`)
      .set("Authorization", await as(vic))
      .send({ email: "xena@example.com", role: "OWNER" });

    expect(res.status).toBe(403);
    expect(await prisma.membership.count({ where: { userId: xena } })).toBe(0);
  });

  it("a non-member gets 404, not 403 — they can't learn the workspace exists", async () => {
    const ws = await oliviasWorkspace();
    const res = await request(app).get(`/workspaces/${ws}/members`).set("Authorization", await as(xena));
    expect(res.status).toBe(404);
  });

  it("owner changes a member's role", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "VIEWER" } });
    const res = await request(app)
      .patch(`/workspaces/${ws}/members/${vic}`)
      .set("Authorization", await as(olivia))
      .send({ role: "EDITOR" });
    expect(res.status).toBe(200);
    expect((await prisma.membership.findFirstOrThrow({ where: { userId: vic } })).role).toBe("EDITOR");
  });

  it("a member can leave; a viewer can't remove someone else", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "VIEWER" } });

    const kick = await request(app).delete(`/workspaces/${ws}/members/${olivia}`).set("Authorization", await as(vic));
    expect(kick.status).toBe(403);

    const leave = await request(app).delete(`/workspaces/${ws}/members/${vic}`).set("Authorization", await as(vic));
    expect(leave.status).toBe(204);
  });
});

describe("the last owner can't be removed or demoted", () => {
  it("409s when the only owner demotes themselves", async () => {
    const ws = await oliviasWorkspace();
    const res = await request(app)
      .patch(`/workspaces/${ws}/members/${olivia}`)
      .set("Authorization", await as(olivia))
      .send({ role: "VIEWER" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_owner");
  });

  it("409s when the only owner tries to leave", async () => {
    const ws = await oliviasWorkspace();
    const res = await request(app).delete(`/workspaces/${ws}/members/${olivia}`).set("Authorization", await as(olivia));
    expect(res.status).toBe(409);
  });

  it("allows it once there's a second owner", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "OWNER" } });
    const res = await request(app).delete(`/workspaces/${ws}/members/${olivia}`).set("Authorization", await as(olivia));
    expect(res.status).toBe(204);
  });

  it("RACE: two owners demoting each other at once can't leave zero owners", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "OWNER" } });

    const [a, b] = await Promise.all([
      request(app).patch(`/workspaces/${ws}/members/${vic}`).set("Authorization", await as(olivia)).send({ role: "VIEWER" }),
      request(app).patch(`/workspaces/${ws}/members/${olivia}`).set("Authorization", await as(vic)).send({ role: "VIEWER" }),
    ]);

    // Exactly one wins. The loser is rejected either by the permission check (403: already
    // demoted by the winner) or by the locked last-owner check (409) — depends on timing.
    // What must ALWAYS hold is the invariant: the workspace keeps exactly one owner.
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    expect(await prisma.membership.count({ where: { workspaceId: ws, role: "OWNER" } })).toBe(1);
  });

  // The HTTP test above almost never hits the dangerous window: each transaction takes
  // ~1ms, so one usually finishes before the other reads. This test FORCES the window
  // with a barrier: each transaction pauses right after reading the owners until the
  // other has read them too.
  //   - Without FOR UPDATE: both read "2 owners", both demote → zero owners → test fails.
  //   - With FOR UPDATE: the 2nd blocks on the lock and never reaches the barrier; the 1st
  //     stops waiting after a timeout and commits; the 2nd then reads 1 owner → 409.
  it("RACE (forced): the row lock prevents simultaneous demotions leaving zero owners", async () => {
    const ws = await oliviasWorkspace();
    await prisma.membership.create({ data: { userId: vic, workspaceId: ws, role: "OWNER" } });

    const wait = barrier(2, 300);
    const results = await Promise.allSettled([
      changeMembership(prisma, ws, vic, "VIEWER", { afterOwnersRead: wait }),
      changeMembership(prisma, ws, olivia, "VIEWER", { afterOwnersRead: wait }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "last_owner" });
    expect(await prisma.membership.count({ where: { workspaceId: ws, role: "OWNER" } })).toBe(1);
  });
});
