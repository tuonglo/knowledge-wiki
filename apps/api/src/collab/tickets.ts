/**
 * One-time tickets for opening a collaboration WebSocket.
 *
 * Browsers can't put an Authorization header on a WebSocket, so the client first asks
 * for a ticket over normal authenticated HTTP, then puts it in the WebSocket URL. A
 * ticket in a URL is harmless: it's good for ONE connection, to ONE page, for 30 s.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

export interface TicketClaims {
  userId: string;
  documentId: string;
}

export interface TicketStore {
  issue(claims: TicketClaims): Promise<string>;
  /** Returns the claims and invalidates the ticket, or null if unknown/expired/used. */
  redeem(ticket: string): Promise<TicketClaims | null>;
}

export const TICKET_TTL_SECONDS = 30;

/** Stored hashed, like refresh tokens: a Redis dump or log doesn't reveal usable tickets. */
const keyFor = (ticket: string) => `collab:ticket:${createHash("sha256").update(ticket).digest("hex")}`;

export function createRedisTicketStore(redis: Redis): TicketStore {
  return {
    async issue(claims) {
      const ticket = randomBytes(32).toString("base64url");
      await redis.set(keyFor(ticket), JSON.stringify(claims), "EX", TICKET_TTL_SECONDS);
      return ticket;
    },
    async redeem(ticket) {
      if (ticket.length === 0 || ticket.length > 100) return null;
      // GETDEL reads and deletes in ONE atomic step: if the same ticket is used twice at
      // the same moment, exactly one connection gets the claims.
      const raw = await redis.getdel(keyFor(ticket));
      return raw ? (JSON.parse(raw) as TicketClaims) : null;
    },
  };
}
