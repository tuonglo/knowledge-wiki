import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp } from "../app.js";
import type { TokenService } from "../auth/jwt.js";
import { bearerFor } from "../test/app.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import { createTestRedis } from "../test/redis.js";
import { createTestTokens } from "../test/tokens.js";
import { createCollabRouter } from "./routes.js";
import { attachCollab, type CollabConnection } from "./server.js";
import { createRedisTicketStore } from "./tickets.js";

const prisma = createTestPrisma();
const redis = createTestRedis();
const tickets = createRedisTicketStore(redis);
const WEB_ORIGIN = "http://web.test";

let tokens: TokenService;
let as: (userId: string) => Promise<string>;
let server: Server;
let collab: ReturnType<typeof attachCollab>;
let base: string; // ws://127.0.0.1:<port>
/** What the server accepted, in order (the "onConnection" hook). */
let accepted: { socket: WebSocket; connection: CollabConnection }[];

/** A real HTTP server on a random port: WebSocket upgrades need one (supertest can't do them). */
function start(heartbeatMs = 30_000) {
  const app = createApp({
    webOrigin: WEB_ORIGIN,
    checks: {},
    routes: { "/collab": createCollabRouter({ prisma, tokens, tickets }) },
  });
  server = app.listen(0);
  collab = attachCollab(server, {
    prisma,
    tickets,
    webOrigin: WEB_ORIGIN,
    heartbeatMs,
    onConnection: (socket, connection) => accepted.push({ socket: socket as WebSocket, connection }),
  });
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  await collab.close();
  await new Promise((r) => server.close(r));
}

beforeAll(async () => {
  tokens = await createTestTokens();
  as = bearerFor(tokens);
});
afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

/*  Acme: olivia OWNER, vic VIEWER. gus: guest with a grant on Projects. xena: outsider. */
let olivia: string, vic: string, gus: string, xena: string;
let ws: string, projects: string, notes: string;

beforeEach(async () => {
  accepted = [];
  await Promise.all([resetDb(prisma), redis.flushdb()]);
  const user = async (name: string) => (await prisma.user.create({ data: { email: `${name}@example.com` } })).id;
  [olivia, vic, gus, xena] = (await Promise.all(["olivia", "vic", "gus", "xena"].map(user))) as [string, string, string, string];
  ws = (await prisma.workspace.create({ data: { name: "Acme" } })).id;
  await prisma.membership.createMany({
    data: [
      { userId: olivia, workspaceId: ws, role: "OWNER" },
      { userId: vic, workspaceId: ws, role: "VIEWER" },
    ],
  });
  projects = (await prisma.document.create({ data: { title: "Projects", workspaceId: ws, createdById: olivia } })).id;
  notes = (await prisma.document.create({ data: { title: "Notes", workspaceId: ws, createdById: olivia } })).id;
  await prisma.documentPermission.create({ data: { userId: gus, documentId: projects, role: "EDITOR" } });
  start();
});
afterEach(stop);

async function ticketFor(userId: string, documentId: string): Promise<string> {
  const res = await request(server).post("/collab/tickets").set("Authorization", await as(userId)).send({ documentId });
  expect(res.status).toBe(201);
  return res.body.ticket;
}

/** Try to open a socket. Resolves with the open socket, or the HTTP status it was refused with. */
function connect(path: string, headers: Record<string, string> = {}): Promise<{ socket: WebSocket } | { status: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${path}`, { headers });
    socket.on("open", () => resolve({ socket }));
    socket.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    socket.on("error", reject);
  });
}

const open = async (documentId: string, ticket: string, headers?: Record<string, string>) =>
  connect(`/collab/${documentId}?ticket=${encodeURIComponent(ticket)}`, headers);

describe("POST /collab/tickets", () => {
  it("gives a short-lived ticket for a page you can view", async () => {
    const res = await request(server).post("/collab/tickets").set("Authorization", await as(vic)).send({ documentId: projects });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticket: expect.any(String), expiresIn: 30 });
  });

  it("404 for a page you can't see, 401 without a token, 400 without a page", async () => {
    const post = () => request(server).post("/collab/tickets");
    expect((await post().set("Authorization", await as(xena)).send({ documentId: projects })).status).toBe(404);
    expect((await post().send({ documentId: projects })).status).toBe(401);
    expect((await post().set("Authorization", await as(olivia)).send({})).status).toBe(400);
  });

  it("stores the ticket hashed: the raw ticket isn't in Redis", async () => {
    const ticket = await ticketFor(olivia, projects);
    const keys = await redis.keys("collab:ticket:*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(ticket);
    expect(await redis.ttl(keys[0]!)).toBeGreaterThan(25);
  });
});

describe("WebSocket /collab/:documentId", () => {
  it("opens with a valid ticket and knows who you are and your role", async () => {
    const result = await open(projects, await ticketFor(olivia, projects));
    expect("socket" in result).toBe(true);
    await expect.poll(() => accepted.length).toBe(1);
    expect(accepted[0]!.connection).toEqual({ userId: olivia, documentId: projects, role: "OWNER" });
  });

  it("viewers connect too, as VIEWER (Step 2 makes them read-only)", async () => {
    await open(projects, await ticketFor(vic, projects));
    await expect.poll(() => accepted[0]?.connection.role).toBe("VIEWER");
  });

  it("a ticket works once", async () => {
    const ticket = await ticketFor(olivia, projects);
    expect("socket" in (await open(projects, ticket))).toBe(true);
    expect(await open(projects, ticket)).toEqual({ status: 401 });
  });

  it("RACE: the same ticket used twice at once → exactly one connection", async () => {
    const ticket = await ticketFor(olivia, projects);
    const results = await Promise.all([open(projects, ticket), open(projects, ticket), open(projects, ticket)]);
    expect(results.filter((r) => "socket" in r)).toHaveLength(1);
    expect(results.filter((r) => "status" in r && r.status === 401)).toHaveLength(2);
  });

  it("a ticket for one page can't open another", async () => {
    expect(await open(notes, await ticketFor(olivia, projects))).toEqual({ status: 401 });
  });

  it("no ticket, or a made-up one → 401", async () => {
    expect(await connect(`/collab/${projects}`)).toEqual({ status: 401 });
    expect(await open(projects, "not-a-real-ticket")).toEqual({ status: 401 });
  });

  it("an expired ticket → 401", async () => {
    const ticket = await ticketFor(olivia, projects);
    for (const key of await redis.keys("collab:ticket:*")) await redis.pexpire(key, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await open(projects, ticket)).toEqual({ status: 401 });
  });

  it("access removed after the ticket was issued → 404 at connect", async () => {
    const ticket = await ticketFor(gus, projects);
    await prisma.documentPermission.deleteMany({ where: { userId: gus } });
    expect(await open(projects, ticket)).toEqual({ status: 404 });
    expect(accepted).toHaveLength(0);
  });

  it("another site's page can't connect (Origin check); our own can", async () => {
    expect(await open(projects, await ticketFor(olivia, projects), { Origin: "https://evil.example" })).toEqual({ status: 403 });
    const ok = await open(projects, await ticketFor(olivia, projects), { Origin: WEB_ORIGIN });
    expect("socket" in ok).toBe(true);
  });

  it("refuses upgrades on any other path", async () => {
    expect(await connect("/somewhere-else")).toEqual({ status: 404 });
  });
});

describe("connection lifecycle", () => {
  it("drops clients that stop answering pings (heartbeat)", async () => {
    await stop();
    start(50);
    const result = await open(projects, await ticketFor(olivia, projects));
    if (!("socket" in result)) throw new Error("expected to connect");
    await expect.poll(() => accepted.length).toBe(1);
    const serverSide = accepted[0]!.socket;
    const closed = new Promise((r) => serverSide.once("close", r));
    // Simulate a laptop going to sleep: the client stops reading, so it never answers pings.
    (result.socket as unknown as { _socket: { pause(): void } })._socket.pause();
    await closed; // the server gives up on it after a missed ping
  });

  it("on shutdown, clients get 1001 'going away' so they know to reconnect", async () => {
    const result = await open(projects, await ticketFor(olivia, projects));
    if (!("socket" in result)) throw new Error("expected to connect");
    const code = new Promise<number>((r) => result.socket.once("close", (c) => r(c)));
    await collab.close();
    expect(await code).toBe(1001);
  });
});
