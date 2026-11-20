import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearerFor, createTestApp } from "../test/app.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import { createTestTokens } from "../test/tokens.js";

const prisma = createTestPrisma();
let app: Express;
let as: (userId: string) => Promise<string>;

beforeAll(async () => {
  const tokens = await createTestTokens();
  app = createTestApp(prisma, tokens);
  as = bearerFor(tokens);
});
afterAll(() => prisma.$disconnect());

/*
 *   Acme (olivia=OWNER, ed=EDITOR, vic=VIEWER)
 *   ├── Projects   ← gus (guest, not a member) has an EDITOR grant
 *   │   └── Roadmap
 *   └── Notes
 *   xena: outsider
 */
let olivia: string, ed: string, vic: string, gus: string, xena: string;
let ws: string, projects: string, roadmap: string, notes: string;

beforeEach(async () => {
  await resetDb(prisma);
  const user = async (name: string) => (await prisma.user.create({ data: { email: `${name}@example.com` } })).id;
  [olivia, ed, vic, gus, xena] = await Promise.all(["olivia", "ed", "vic", "gus", "xena"].map(user)) as string[] as [
    string, string, string, string, string,
  ];
  ws = (await prisma.workspace.create({ data: { name: "Acme" } })).id;
  await prisma.membership.createMany({
    data: [
      { userId: olivia, workspaceId: ws, role: "OWNER" },
      { userId: ed, workspaceId: ws, role: "EDITOR" },
      { userId: vic, workspaceId: ws, role: "VIEWER" },
    ],
  });
  const doc = async (title: string, parentId?: string) =>
    (await prisma.document.create({ data: { title, workspaceId: ws, parentId, createdById: olivia } })).id;
  projects = await doc("Projects");
  roadmap = await doc("Roadmap", projects);
  notes = await doc("Notes");
  await prisma.documentPermission.create({ data: { userId: gus, documentId: projects, role: "EDITOR" } });
});

describe("Phase 1 'done when': a viewer gets 403 on writes", () => {
  it("viewer can read a page...", async () => {
    const res = await request(app).get(`/documents/${notes}`).set("Authorization", await as(vic));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Notes", role: "VIEWER" });
  });

  it("...but can't rename it (403), and nothing changes", async () => {
    const res = await request(app).patch(`/documents/${notes}`).set("Authorization", await as(vic)).send({ title: "Hacked" });
    expect(res.status).toBe(403);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: notes } })).title).toBe("Notes");
  });

  it("...or create pages (403)", async () => {
    const res = await request(app).post(`/workspaces/${ws}/documents`).set("Authorization", await as(vic)).send({ title: "x" });
    expect(res.status).toBe(403);
  });

  it("...or delete them (403)", async () => {
    const res = await request(app).delete(`/documents/${notes}`).set("Authorization", await as(vic));
    expect(res.status).toBe(403);
  });
});

describe("editors and owners", () => {
  it("editor renames a page", async () => {
    const res = await request(app).patch(`/documents/${notes}`).set("Authorization", await as(ed)).send({ title: "Team notes" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Team notes");
  });

  it("editor creates top-level and nested pages", async () => {
    const top = await request(app).post(`/workspaces/${ws}/documents`).set("Authorization", await as(ed)).send({ title: "Ideas" });
    expect(top.status).toBe(201);
    const sub = await request(app)
      .post(`/workspaces/${ws}/documents`)
      .set("Authorization", await as(ed))
      .send({ title: "Idea 1", parentId: top.body.id });
    expect(sub.status).toBe(201);
    expect(sub.body.parentId).toBe(top.body.id);
  });

  it("editor can't delete (needs manage = OWNER); owner can, and sub-pages go too", async () => {
    expect((await request(app).delete(`/documents/${projects}`).set("Authorization", await as(ed))).status).toBe(403);
    expect((await request(app).delete(`/documents/${projects}`).set("Authorization", await as(olivia))).status).toBe(204);
    expect(await prisma.document.findUnique({ where: { id: roadmap } })).toBeNull();
  });
});

describe("guests (page grant, no membership)", () => {
  it("see only their granted pages in the tree", async () => {
    const res = await request(app).get(`/workspaces/${ws}/documents`).set("Authorization", await as(gus));
    expect(res.status).toBe(200);
    expect(res.body.map((d: { title: string }) => d.title).sort()).toEqual(["Projects", "Roadmap"]);
  });

  it("can add sub-pages under a page they can edit", async () => {
    const res = await request(app)
      .post(`/workspaces/${ws}/documents`)
      .set("Authorization", await as(gus))
      .send({ title: "Gus's page", parentId: roadmap });
    expect(res.status).toBe(201);
  });

  it("can't create top-level pages (not a workspace editor)", async () => {
    const res = await request(app).post(`/workspaces/${ws}/documents`).set("Authorization", await as(gus)).send({ title: "x" });
    expect(res.status).toBe(404); // not a member → the workspace doesn't exist for them
  });
});

describe("outsiders get 404 everywhere — never 403", () => {
  it("can't read a page", async () => {
    expect((await request(app).get(`/documents/${notes}`).set("Authorization", await as(xena))).status).toBe(404);
  });

  it("can't edit a page", async () => {
    const res = await request(app).patch(`/documents/${notes}`).set("Authorization", await as(xena)).send({ title: "x" });
    expect(res.status).toBe(404);
  });

  it("can't list the tree", async () => {
    expect((await request(app).get(`/workspaces/${ws}/documents`).set("Authorization", await as(xena))).status).toBe(404);
  });

  it("gets the same 404 for a real page and a made-up one (no existence oracle)", async () => {
    const real = await request(app).get(`/documents/${notes}`).set("Authorization", await as(xena));
    const fake = await request(app).get(`/documents/does-not-exist`).set("Authorization", await as(xena));
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });
});

describe("sub-page rules", () => {
  it("rejects a parent from another workspace", async () => {
    const other = (await prisma.workspace.create({ data: { name: "Other" } })).id;
    await prisma.membership.create({ data: { userId: ed, workspaceId: other, role: "EDITOR" } });

    const res = await request(app)
      .post(`/workspaces/${other}/documents`)
      .set("Authorization", await as(ed))
      .send({ title: "x", parentId: notes });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("parent_in_other_workspace");
  });
});
