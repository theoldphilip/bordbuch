import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import {
  createUser,
  hashPassword,
  issueToken,
  requireAdmin,
  requireUser,
  userFromRow,
  verifyPassword,
} from '../auth.ts';
import { tx } from '../db.ts';
import { createUserInput, loginInput, resetPasswordInput, setupInput, updateMeInput } from '../schemas.ts';
import { HttpError } from '../util.ts';

export function registerAuthRoutes(app: FastifyInstance, { db }: Ctx) {
  const userCount = () => (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;

  app.get('/api/setup', { config: { public: true } }, async () => ({ needsSetup: userCount() === 0 }));

  /** First run: create the admin account. Only possible while no user exists. */
  app.post('/api/setup', { config: { public: true } }, async (req, reply) => {
    const input = setupInput.parse(req.body);
    const result = tx(db, () => {
      if (userCount() > 0) throw new HttpError(409, 'Einrichtung wurde bereits abgeschlossen');
      const user = createUser(db, { ...input, isAdmin: true });
      return { user, token: issueToken(db, user.id, 'Einrichtung') };
    });
    return reply.status(201).send(result);
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req) => {
    const input = loginInput.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username) as
      | { id: string; username: string; display_name: string; is_admin: number; password_hash: string }
      | undefined;
    if (!row || !verifyPassword(input.password, row.password_hash)) {
      throw new HttpError(401, 'Benutzername oder Passwort falsch');
    }
    return { user: userFromRow(row), token: issueToken(db, row.id, input.deviceName) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(req.tokenHash);
    return reply.status(204).send();
  });

  app.get('/api/me', async (req) => requireUser(req));

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const input = updateMeInput.parse(req.body);
    if (input.displayName) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(input.displayName, user.id);
    }
    if (input.newPassword) {
      const { password_hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as {
        password_hash: string;
      };
      if (!input.currentPassword || !verifyPassword(input.currentPassword, password_hash)) {
        throw new HttpError(400, 'Aktuelles Passwort ist falsch');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.newPassword), user.id);
      // Sign out all other devices.
      db.prepare('DELETE FROM tokens WHERE user_id = ? AND token_hash <> ?').run(user.id, req.tokenHash);
    }
    return userFromRow(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as never);
  });

  // ----- family members (users) -----
  app.get('/api/users', async () =>
    (db.prepare('SELECT * FROM users ORDER BY display_name').all() as never[]).map(userFromRow),
  );

  app.post('/api/users', async (req, reply) => {
    requireAdmin(req);
    const input = createUserInput.parse(req.body);
    return reply.status(201).send(createUser(db, input));
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (req, reply) => {
    requireAdmin(req);
    const { password } = resetPasswordInput.parse(req.body);
    const res = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.params.id);
    if (res.changes === 0) throw new HttpError(404, 'Benutzer nicht gefunden');
    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(req.params.id);
    return reply.status(204).send();
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const admin = requireAdmin(req);
    if (admin.id === req.params.id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
    tx(db, () => {
      // Trips where this user is the only owner are handed over to the admin.
      const soleOwned = db
        .prepare(
          `SELECT trip_id FROM trip_members m
            WHERE user_id = ? AND role = 'owner'
              AND NOT EXISTS (SELECT 1 FROM trip_members o WHERE o.trip_id = m.trip_id AND o.role = 'owner' AND o.user_id <> m.user_id)`,
        )
        .all(req.params.id) as { trip_id: string }[];
      for (const { trip_id } of soleOwned) {
        db.prepare(
          `INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, 'owner')
           ON CONFLICT (trip_id, user_id) DO UPDATE SET role = 'owner'`,
        ).run(trip_id, admin.id);
      }
      const res = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
      if (res.changes === 0) throw new HttpError(404, 'Benutzer nicht gefunden');
    });
    return reply.status(204).send();
  });
}
