/**
 * The WebSocket half of collaboration: GET /collab/:documentId?ticket=… with an Upgrade.
 *
 * Every check happens DURING the HTTP upgrade, before a socket exists. A request that
 * fails gets a plain HTTP error (401/403/404) and is closed, so unauthenticated clients
 * never hold an open connection.
 */
import type { IncomingMessage, Server } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import type { PrismaClient, Role } from "../generated/prisma/client.js";
import { getDocumentRole } from "../permissions.js";
import type { TicketStore } from "./tickets.js";

/** Who is on the other end of a socket. */
export interface CollabConnection {
  userId: string;
  documentId: string;
  /** Role at connect time. VIEWERs will be read-only (Step 2). */
  role: Role;
}

export interface CollabDeps {
  prisma: PrismaClient;
  tickets: TicketStore;
  webOrigin: string;
  /** Called for each accepted socket. Step 2 plugs the Yjs rooms in here. */
  onConnection?: (socket: WebSocket, connection: CollabConnection) => void;
  /** Ping interval for detecting dead connections. */
  heartbeatMs?: number;
}

/** A page's Yjs state is capped at ~3 MB (see SaveContentBody); allow some headroom. */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

const PATH = /^\/collab\/([^/]+)$/;

export function attachCollab(server: Server, deps: CollabDeps): { close(): Promise<void> } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy()); // client vanished mid-handshake
    handleUpgrade(req, socket, head).catch((err) => {
      console.error("collab upgrade failed", err);
      reject(socket, 500);
    });
  });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://internal");
    const match = PATH.exec(url.pathname);
    if (!match) return reject(socket, 404);

    // Browsers always send Origin on WebSockets, and the same-origin policy doesn't
    // protect them. Tickets already stop cross-site use; this is defense in depth.
    // (No Origin = not a browser, e.g. a test or script: tickets still apply.)
    const origin = req.headers.origin;
    if (origin && origin !== deps.webOrigin) return reject(socket, 403);

    const documentId = decodeURIComponent(match[1]!);
    const claims = await deps.tickets.redeem(url.searchParams.get("ticket") ?? "");
    // A ticket is for one page only: no using a ticket for page A to open page B.
    if (!claims || claims.documentId !== documentId) return reject(socket, 401);

    // Check access again now: it may have been revoked since the ticket was issued.
    const role = await getDocumentRole(deps.prisma, claims.userId, documentId);
    if (!role) return reject(socket, 404);

    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      deps.onConnection?.(ws, { userId: claims.userId, documentId, role });
    });
  }

  // Heartbeat: a laptop that sleeps or loses Wi-Fi doesn't always close its socket.
  // Ping everyone; whoever hasn't answered since the last ping is gone.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, deps.heartbeatMs ?? 30_000);
  heartbeat.unref(); // don't keep the process alive just for this

  return {
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        // 1001 "going away": clients should reconnect (to another instance, or after a deploy).
        for (const ws of wss.clients) ws.close(1001, "server shutting down");
        wss.close(() => resolve());
      }),
  };
}

/** Answer an upgrade request with a plain HTTP error and hang up. */
function reject(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
