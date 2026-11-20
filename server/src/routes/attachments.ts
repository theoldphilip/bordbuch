import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { tx } from '../db.ts';
import { attachmentFromRow, touchTrip } from '../model.ts';
import { HttpError, newId, nowIso } from '../util.ts';

export function registerAttachmentRoutes(app: FastifyInstance, { db, uploadDir, config }: Ctx) {
  const attachmentRow = (id: string) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
    return row;
  };

  /** Multipart upload with a single "file" field. Optional ?itemId= links the file to an entry. */
  app.post<{ Params: { tripId: string }; Querystring: { itemId?: string } }>(
    '/api/trips/:tripId/attachments',
    async (req, reply) => {
      const user = requireUser(req);
      const { tripId } = req.params;
      requireTripRole(db, tripId, user.id, 'editor');
      const itemId = req.query.itemId || null;
      if (itemId && !db.prepare('SELECT 1 FROM items WHERE id = ? AND trip_id = ?').get(itemId, tripId)) {
        throw new HttpError(400, 'Eintrag gehört nicht zu dieser Reise');
      }
      const file = await req.file();
      if (!file) throw new HttpError(400, 'Keine Datei übermittelt');

      const id = newId();
      const storedName = id;
      const target = path.join(uploadDir, storedName);
      await pipeline(file.file, fs.createWriteStream(target));
      if (file.file.truncated) {
        fs.rmSync(target, { force: true });
        throw new HttpError(413, `Datei ist größer als ${config.maxUploadMb} MB`);
      }
      const size = fs.statSync(target).size;
      const filename = path.basename(file.filename || 'Dokument').slice(0, 200);
      tx(db, () => {
        db.prepare(
          `INSERT INTO attachments (id, trip_id, item_id, filename, mime, size, stored_name, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, tripId, itemId, filename, file.mimetype || 'application/octet-stream', size, storedName, user.id, nowIso());
        touchTrip(db, tripId);
      });
      return reply.status(201).send(attachmentFromRow(attachmentRow(id)));
    },
  );

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/attachments/:id', async (req, reply) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'viewer');
    const disposition = req.query.download ? 'attachment' : 'inline';
    return reply
      .header('Content-Type', row.mime)
      .header('Content-Length', row.size)
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
      .header('Cache-Control', 'private, max-age=86400')
      .send(fs.createReadStream(path.join(uploadDir, row.stored_name)));
  });

  app.patch<{ Params: { id: string } }>('/api/attachments/:id', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    const body = (req.body ?? {}) as { filename?: unknown; itemId?: unknown };
    const filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim().slice(0, 200) : row.filename;
    let itemId = row.item_id as string | null;
    if (body.itemId !== undefined) {
      itemId = typeof body.itemId === 'string' && body.itemId ? body.itemId : null;
      if (itemId && !db.prepare('SELECT 1 FROM items WHERE id = ? AND trip_id = ?').get(itemId, row.trip_id)) {
        throw new HttpError(400, 'Eintrag gehört nicht zu dieser Reise');
      }
    }
    tx(db, () => {
      db.prepare('UPDATE attachments SET filename = ?, item_id = ? WHERE id = ?').run(filename, itemId, req.params.id);
      touchTrip(db, row.trip_id);
    });
    return attachmentFromRow(attachmentRow(req.params.id));
  });

  app.delete<{ Params: { id: string } }>('/api/attachments/:id', async (req, reply) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    tx(db, () => {
      db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
      touchTrip(db, row.trip_id);
    });
    fs.rmSync(path.join(uploadDir, row.stored_name), { force: true });
    return reply.status(204).send();
  });
}
