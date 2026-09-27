import { randomBytes } from "node:crypto";
import type { GithubCredential } from "../types/github.js";
import type { Session, SessionUser } from "./authTypes.js";

/**
 * Session storage, behind an interface so the in-memory implementation can be
 * swapped for Redis or a database without touching the auth flow.
 *
 * NOT PRODUCTION READY as implemented: `createInMemorySessionStore` keeps
 * sessions in the process heap, so they are lost on restart and are not shared
 * between instances. A multi-instance deployment would log users out at
 * random as requests land on different processes.
 */
export interface SessionStore {
  create(user: SessionUser, credential: GithubCredential): Session;
  /** Returns null for unknown or expired sessions, evicting the latter. */
  get(id: string): Session | null;
  delete(id: string): void;
  /** Test/diagnostic helper. */
  size(): number;
}

/** Opaque, unguessable identifier. 32 bytes from the CSPRNG. */
export function createOpaqueId(): string {
  return randomBytes(32).toString("base64url");
}

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createInMemorySessionStore(
  ttlMs: number = SESSION_TTL_MS,
  now: () => number = Date.now
): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    create(user, credential) {
      const issuedAt = now();
      const session: Session = {
        id: createOpaqueId(),
        user,
        credential,
        createdAt: issuedAt,
        expiresAt: issuedAt + ttlMs,
      };
      sessions.set(session.id, session);
      return session;
    },

    get(id) {
      const session = sessions.get(id);
      if (session === undefined) return null;

      if (session.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }

      return session;
    },

    delete(id) {
      sessions.delete(id);
    },

    size() {
      return sessions.size;
    },
  };
}

/**
 * Single-use CSRF state for the authorization callback.
 *
 * A state is issued when the flow starts, and must be presented and consumed
 * exactly once on the way back. Replaying it fails.
 */
export interface StateStore {
  issue(): string;
  /** True only the first time a valid, unexpired state is presented. */
  consume(state: string): boolean;
  size(): number;
}

export const STATE_TTL_MS = 10 * 60 * 1000;

export function createInMemoryStateStore(
  ttlMs: number = STATE_TTL_MS,
  now: () => number = Date.now
): StateStore {
  const states = new Map<string, number>();

  return {
    issue() {
      const state = createOpaqueId();
      states.set(state, now() + ttlMs);
      return state;
    },

    consume(state) {
      const expiresAt = states.get(state);
      if (expiresAt === undefined) return false;

      // Consumed either way: a state is never valid twice.
      states.delete(state);
      return expiresAt > now();
    },

    size() {
      return states.size;
    },
  };
}
