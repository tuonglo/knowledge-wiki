import { Role } from "@kw/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canAccess, getDocumentRole, getWorkspaceRole, listAccessibleDocuments } from "./permissions.js";
import { createTestPrisma, resetDb } from "./test/db.js";

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

/*
 * The test world:
 *
 *   Workspace "Acme"  (members: olivia=OWNER, ed=EDITOR, vic=VIEWER)
 *   ├── Projects        ← gus (NOT a member) has an EDITOR grant
 *   │   └── Roadmap
 *   │       └── Q1      ← inherits gus's grant two levels down
 *   └── Notes           ← vic has an EDITOR grant (raises VIEWER)
 *                       ← ed has a VIEWER grant (must NOT lower EDITOR)
 *   Workspace "Other"   (member: zoe=OWNER)
 *   └── Secret
 *   xena: no memberships, no grants
 */
const u: Record<string, string> = {};
const d: Record<string, string> = {};
let acme: string;

beforeAll(async () => {
  await resetDb(prisma);
  for (const name of ["olivia", "ed", "vic", "gus", "zoe", "xena"]) {
    u[name] = (await prisma.user.create({ data: { email: `${name}@example.com` } })).id;
  }
  acme = (await prisma.workspace.create({ data: { name: "Acme" } })).id;
  const other = (await prisma.workspace.create({ data: { name: "Other" } })).id;

  await prisma.membership.createMany({
    data: [
      { userId: u.olivia!, workspaceId: acme, role: "OWNER" },
      { userId: u.ed!, workspaceId: acme, role: "EDITOR" },
      { userId: u.vic!, workspaceId: acme, role: "VIEWER" },
      { userId: u.zoe!, workspaceId: other, role: "OWNER" },
    ],
  });

  const doc = async (title: string, workspaceId: string, parentId?: string) =>
    (await prisma.document.create({ data: { title, workspaceId, parentId, createdById: u.olivia! } })).id;
  d.projects = await doc("Projects", acme);
  d.roadmap = await doc("Roadmap", acme, d.projects);
  d.q1 = await doc("Q1", acme, d.roadmap);
  d.notes = await doc("Notes", acme);
  d.secret = await doc("Secret", other);

  await prisma.documentPermission.createMany({
    data: [
      { userId: u.gus!, documentId: d.projects, role: "EDITOR" },
      { userId: u.vic!, documentId: d.notes, role: "EDITOR" },
      { userId: u.ed!, documentId: d.notes, role: "VIEWER" },
    ],
  });
});

// Every user × every document. null = no access.
const expected: Record<string, Record<string, Role | null>> = {
  //        projects   roadmap    q1         notes      secret
  olivia: { projects: "OWNER", roadmap: "OWNER", q1: "OWNER", notes: "OWNER", secret: null },
  ed: { projects: "EDITOR", roadmap: "EDITOR", q1: "EDITOR", notes: "EDITOR", secret: null },
  vic: { projects: "VIEWER", roadmap: "VIEWER", q1: "VIEWER", notes: "EDITOR", secret: null },
  gus: { projects: "EDITOR", roadmap: "EDITOR", q1: "EDITOR", notes: null, secret: null },
  zoe: { projects: null, roadmap: null, q1: null, notes: null, secret: "OWNER" },
  xena: { projects: null, roadmap: null, q1: null, notes: null, secret: null },
};

describe("getDocumentRole — the full truth table", () => {
  for (const [user, docs] of Object.entries(expected)) {
    for (const [docName, role] of Object.entries(docs)) {
      it(`${user} on ${docName} → ${role ?? "no access"}`, async () => {
        expect(await getDocumentRole(prisma, u[user]!, d[docName]!)).toBe(role);
      });
    }
  }
});

describe("rules worth calling out", () => {
  it("a grant on a page reaches every descendant, however deep", async () => {
    expect(await getDocumentRole(prisma, u.gus!, d.q1!)).toBe("EDITOR");
  });

  it("a lower grant never demotes a workspace role", async () => {
    expect(await getDocumentRole(prisma, u.ed!, d.notes!)).toBe("EDITOR");
  });

  it("a document grant doesn't make you a workspace member", async () => {
    expect(await getWorkspaceRole(prisma, u.gus!, acme)).toBeNull();
    expect(await getWorkspaceRole(prisma, u.vic!, acme)).toBe("VIEWER");
  });

  it("an unknown document id is simply no access", async () => {
    expect(await getDocumentRole(prisma, u.olivia!, "does-not-exist")).toBeNull();
  });

  it("is safe against SQL injection in the ids", async () => {
    const evil = `x'); DELETE FROM "User"; --`;
    expect(await getDocumentRole(prisma, evil, d.notes!)).toBeNull();
    expect(await prisma.user.count()).toBe(6);
  });
});

describe("canAccess — actions map to minimum roles", () => {
  const cases: [user: string, doc: string, action: "view" | "edit" | "manage", allowed: boolean][] = [
    ["vic", "projects", "view", true],
    ["vic", "projects", "edit", false], // viewer
    ["vic", "notes", "edit", true], // raised by grant
    ["ed", "projects", "manage", false], // only owners manage
    ["olivia", "projects", "manage", true],
    ["gus", "roadmap", "edit", true], // inherited grant
    ["gus", "notes", "view", false], // grant doesn't spread sideways
    ["xena", "projects", "view", false],
  ];
  for (const [user, doc, action, allowed] of cases) {
    it(`${user} ${allowed ? "can" : "cannot"} ${action} ${doc}`, async () => {
      expect(await canAccess(prisma, u[user]!, d[doc]!, action)).toBe(allowed);
    });
  }
});

describe("listAccessibleDocuments (what the AI service will filter by)", () => {
  it("returns exactly the documents the user can see", async () => {
    const docs = await listAccessibleDocuments(prisma, u.gus!);
    expect(docs.map((x) => x.documentId).sort()).toEqual([d.projects, d.roadmap, d.q1].sort());
  });
});

describe("consistency between TypeScript and the database", () => {
  it("the Postgres Role enum is in the same order as @kw/shared's Role", async () => {
    // The SQL function's max(role) relies on enum ORDER. If someone reorders one side, fail loudly.
    const [row] = await prisma.$queryRaw<{ values: string[] }[]>`
      SELECT enum_range(NULL::"Role")::text[] AS values`;
    expect(row!.values).toEqual(Role.options);
  });
});

describe("changes take effect immediately (no stale tokens)", () => {
  it("removing a membership revokes access on the very next check", async () => {
    const temp = (await prisma.user.create({ data: { email: "temp@example.com" } })).id;
    await prisma.membership.create({ data: { userId: temp, workspaceId: acme, role: "EDITOR" } });
    expect(await canAccess(prisma, temp, d.notes!, "edit")).toBe(true);

    await prisma.membership.delete({ where: { userId_workspaceId: { userId: temp, workspaceId: acme } } });
    expect(await canAccess(prisma, temp, d.notes!, "view")).toBe(false);
  });
});
