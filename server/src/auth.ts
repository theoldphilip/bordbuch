import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { DB } from './db.ts';
import { HttpError, newId, nowIso } from './util.ts';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    tokenHash: string | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function issueToken(db: DB, userId: string, deviceName: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const now = nowIso();
  db.prepare(
    'INSERT INTO tokens (token_hash, user_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, deviceName, now, now);
  return token;
}

export function createUser(
  db: DB,
  input: { username: string; displayName: string; password: string; isAdmin: boolean },
): AuthUser {
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username);
  if (exists) throw new HttpError(409, 'Benutzername ist bereits vergeben');
  const id = newId();
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.username, input.displayName, hashPassword(input.password), input.isAdmin ? 1 : 0, nowIso());
  return { id, username: input.username, displayName: input.displayName, isAdmin: input.isAdmin };
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  is_admin: number;
}

export const userFromRow = (r: UserRow): AuthUser => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  isAdmin: r.is_admin === 1,
});

export function authenticate(db: DB, req: FastifyRequest): void {
  const header = req.headers.authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, 'Nicht angemeldet');
  const tokenHash = hashToken(match[1]!.trim());
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_admin, t.last_used_at
         FROM tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?`,
    )
    .get(tokenHash) as (UserRow & { last_used_at: string }) | undefined;
  if (!row) throw new HttpError(401, 'Sitzung ungültig oder abgelaufen');
  // Only write last_used_at about once per hour to keep the DB quiet.
  if (Date.now() - Date.parse(row.last_used_at) > 3_600_000) {
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash);
  }
  req.user = userFromRow(row);
  req.tokenHash = tokenHash;
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Nicht angemeldet');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (!user.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
  return user;
}

export type Role = 'owner' | 'editor' | 'viewer';
const roleRank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** Returns the user's role on the trip, or throws 404/403. */
export function requireTripRole(db: DB, tripId: string, userId: string, min: Role): Role {
  const row = db
    .prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?')
    .get(tripId, userId) as { role: Role } | undefined;
  if (!row) throw new HttpError(404, 'Reise nicht gefunden');
  if (roleRank[row.role] < roleRank[min]) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
  return row.role;
}
