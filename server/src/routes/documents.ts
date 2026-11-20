/**
 * Document inbox: upload a travel document, let the AI read it, review the proposals, apply them.
 * Nothing the AI returns is written to trips or items without an explicit apply call from a user
 * with edit rights, and apply validates everything again like any other edit.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { describeAiError } from '../ai/anthropic.ts';
import { classifyFile } from '../ai/files.ts';
import { normalizeExtraction } from '../ai/normalize.ts';
import { buildProposals, findDay, mergeItem } from '../ai/proposals.ts';
import type { ExtractionContext, ItemData, NormalizedExtraction } from '../ai/types.ts';
import { requireAdmin, requireTripRole, requireUser } from '../auth.ts';
import { tx } from '../db.ts';
import { attachmentFromRow, itemFromRow, loadCruises, loadItems, loadTrip, touchTrip } from '../model.ts';
import { cruiseCreateInput, cruiseDayInput, cruiseInput, itemInput } from '../schemas.ts';
import { HttpError, newId, nowIso } from '../util.ts';
import { receiveUpload } from './attachments.ts';
import { insertDay } from './cruises.ts';
import { checkCruiseDay } from './items.ts';

const applyInput = z.object({
  items: z
    .array(
      z.object({
        action: z.enum(['create', 'update', 'skip']),
        itemId: z.string().optional(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(50)
    .default([]),
  cruise: z
    .object({
      action: z.enum(['create', 'update', 'skip']),
      cruiseId: z.string().optional(),
      data: z.record(z.string(), z.unknown()),
    })
    .nullish(),
});

type Row = Record<string, any>;

export function registerDocumentRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, uploadDir, extractor, config } = ctx;

  // A restart can interrupt a running analysis; don't leave it "pending" forever.
  db.prepare(
    `UPDATE attachments SET analysis_status = 'failed', analysis_error = 'Die Analyse wurde unterbrochen. Bitte erneut starten.'
      WHERE analysis_status = 'pending'`,
  ).run();

  const attachmentRow = (id: string): Row => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
    return row;
  };
  const setStatus = (id: string, status: string | null, error: string | null = null) =>
    db.prepare('UPDATE attachments SET analysis_status = ?, analysis_error = ? WHERE id = ?').run(status, error, id);

  function contextFor(tripId: string): ExtractionContext {
    const trip = loadTrip(db, tripId);
    return {
      today: new Date().toISOString().slice(0, 10),
      defaultTz: config.defaultTz,
      tripTitle: trip.title,
      cruiseDays: loadCruises(db, tripId).flatMap((c) =>
        c.days.map((d) => ({ id: d.id, date: d.date, kind: d.kind, portName: d.portName, country: d.country, shipName: c.shipName })),
      ),
    };
  }

  /** Runs the analysis and stores the result. Never throws: failures are stored on the attachment. */
  async function analyze(id: string): Promise<void> {
    const row = attachmentRow(id);
    if (!extractor) return;
    if (!classifyFile(row.mime, row.filename)) return;
    setStatus(id, 'pending');
    try {
      const data = fs.readFileSync(path.join(uploadDir, row.stored_name));
      const context = contextFor(row.trip_id);
      const ai = await extractor.extract({ data, mime: row.mime, filename: row.filename, context });
      const normalized = normalizeExtraction(ai, context, extractor.model);
      db.prepare("UPDATE attachments SET analysis = ?, analysis_status = 'done', analysis_error = NULL WHERE id = ?").run(
        JSON.stringify(normalized),
        id,
      );
    } catch (err) {
      app.log.warn({ err }, 'Dokument-Analyse fehlgeschlagen');
      setStatus(id, 'failed', describeAiError(err));
    }
  }

  const view = (id: string) => attachmentFromRow(attachmentRow(id));

  // ----- status & key check -----
  app.get('/api/ai/status', async () => ({ enabled: !!extractor, model: extractor?.model ?? null }));

  app.post('/api/ai/check', async (req) => {
    requireAdmin(req);
    if (!extractor) throw new HttpError(409, 'Die Dokument-Analyse ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    try {
      await extractor.check();
    } catch (err) {
      throw new HttpError(502, describeAiError(err));
    }
    return { ok: true, model: extractor.model };
  });

  // ----- upload + analyse -----
  app.post<{ Params: { tripId: string }; Querystring: { itemId?: string } }>('/api/trips/:tripId/documents', async (req, reply) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    const itemId = req.query.itemId || null;
    if (itemId && !db.prepare('SELECT 1 FROM items WHERE id = ? AND trip_id = ?').get(itemId, tripId)) {
      throw new HttpError(400, 'Eintrag gehört nicht zu dieser Reise');
    }
    const id = await receiveUpload(ctx, req, tripId, user.id, itemId);
    const row = attachmentRow(id);
    const analyzable = classifyFile(row.mime, row.filename) !== null;
    if (extractor && analyzable) await analyze(id);
    return reply.status(201).send({ attachment: view(id), aiEnabled: !!extractor, analyzable });
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/analyze', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    if (!extractor) throw new HttpError(409, 'Die Dokument-Analyse ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    if (!classifyFile(row.mime, row.filename)) throw new HttpError(400, 'Dieser Dateityp kann nicht automatisch gelesen werden.');
    if (row.analysis_status === 'pending') throw new HttpError(409, 'Die Analyse läuft bereits.');
    await analyze(req.params.id);
    return view(req.params.id);
  });

  // ----- proposals -----
  app.get<{ Params: { id: string } }>('/api/attachments/:id/analysis', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'viewer');
    if (!row.analysis) throw new HttpError(404, 'Für dieses Dokument liegt keine Analyse vor');
    const normalized = JSON.parse(row.analysis) as NormalizedExtraction;
    return {
      status: row.analysis_status,
      attachment: view(req.params.id),
      ...buildProposals(normalized, { items: loadItems(db, row.trip_id), cruises: loadCruises(db, row.trip_id) }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/dismiss', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    setStatus(req.params.id, 'dismissed');
    return view(req.params.id);
  });

  // ----- apply -----
  app.post<{ Params: { id: string } }>('/api/attachments/:id/apply', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    const tripId: string = row.trip_id;
    requireTripRole(db, tripId, user.id, 'editor');
    const input = applyInput.parse(req.body);

    const created: string[] = [];
    const updated: string[] = [];
    let cruiseId: string | null = null;

    tx(db, () => {
      // 1) Cruise first, so its days exist.
      const c = input.cruise;
      if (c && c.action === 'create') {
        const data = cruiseCreateInput.parse(c.data);
        cruiseId = newId();
        const now = nowIso();
        db.prepare(
          `INSERT INTO cruises (id, trip_id, ship_name, cruise_line, cabin, booking_ref, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(cruiseId, tripId, data.shipName, data.cruiseLine, data.cabin, data.bookingRef, data.notes, now, now);
        for (const d of data.days) insertDay(db, cruiseId, d);
      } else if (c && c.action === 'update') {
        const existing = loadCruises(db, tripId).find((x) => x.id === c.cruiseId);
        if (!existing) throw new HttpError(400, 'Die zu aktualisierende Kreuzfahrt gehört nicht zu dieser Reise');
        cruiseId = existing.id;
        const patch = cruiseInput.parse({
          shipName: existing.shipName,
          cruiseLine: (c.data.cruiseLine as string | null) ?? existing.cruiseLine,
          cabin: (c.data.cabin as string | null) ?? existing.cabin,
          bookingRef: (c.data.bookingRef as string | null) ?? existing.bookingRef,
          notes: existing.notes ?? (c.data.notes as string | null) ?? null,
        });
        db.prepare('UPDATE cruises SET cruise_line = ?, cabin = ?, booking_ref = ?, notes = ?, updated_at = ? WHERE id = ?').run(
          patch.cruiseLine, patch.cabin, patch.bookingRef, patch.notes, nowIso(), existing.id,
        );
        const days = z.array(cruiseDayInput).max(200).parse(c.data.days ?? []);
        for (const d of days) {
          const same = findDay(existing, d);
          if (!same) {
            insertDay(db, existing.id, d);
            continue;
          }
          const m = {
            date: d.date, kind: d.kind,
            portName: d.portName ?? same.portName, country: d.country ?? same.country, timezone: d.timezone ?? same.timezone,
            arrival: d.arrival ?? same.arrival, departure: d.departure ?? same.departure, allAboard: d.allAboard ?? same.allAboard,
            tender: d.tender || same.tender, notes: same.notes ?? d.notes,
          };
          db.prepare(
            `UPDATE cruise_days SET date = ?, kind = ?, port_name = ?, country = ?, timezone = ?, arrival = ?, departure = ?,
                    all_aboard = ?, tender = ?, notes = ? WHERE id = ?`,
          ).run(m.date, m.kind, m.portName, m.country, m.timezone, m.arrival, m.departure, m.allAboard, m.tender ? 1 : 0, m.notes, same.id);
        }
      }

      // 2) Items
      for (const entry of input.items) {
        if (entry.action === 'skip') continue;
        if (entry.action === 'create') {
          const data = itemInput.parse(entry.data);
          checkCruiseDay(db, tripId, data.cruiseDayId);
          const id = newId();
          const now = nowIso();
          db.prepare(
            `INSERT INTO items (id, trip_id, type, title, start_local, start_tz, end_local, end_tz, location, confirmation, provider,
                                cost, currency, notes, details, cruise_day_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id, tripId, data.type, data.title, data.startLocal, data.startTz, data.endLocal, data.endTz, data.location,
            data.confirmation, data.provider, data.cost, data.currency, data.notes, JSON.stringify(data.details), data.cruiseDayId, now, now,
          );
          created.push(id);
        } else {
          const existingRow = db.prepare('SELECT * FROM items WHERE id = ? AND trip_id = ?').get(entry.itemId ?? '', tripId) as Row | undefined;
          if (!existingRow) throw new HttpError(400, 'Der zu aktualisierende Eintrag gehört nicht zu dieser Reise');
          const existing = itemFromRow(existingRow);
          const base: ItemData = {
            type: existing.type, title: existing.title, startLocal: '', startTz: null, endLocal: null, endTz: null, location: null,
            confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details: {},
          };
          const merged = itemInput.parse(mergeItem(existing, { ...base, ...(entry.data as Partial<ItemData>) }));
          checkCruiseDay(db, tripId, merged.cruiseDayId);
          db.prepare(
            `UPDATE items SET title = ?, start_local = ?, start_tz = ?, end_local = ?, end_tz = ?, location = ?, confirmation = ?,
                    provider = ?, cost = ?, currency = ?, notes = ?, details = ?, cruise_day_id = ?, updated_at = ? WHERE id = ?`,
          ).run(
            merged.title, merged.startLocal, merged.startTz, merged.endLocal, merged.endTz, merged.location, merged.confirmation,
            merged.provider, merged.cost, merged.currency, merged.notes, JSON.stringify(merged.details), merged.cruiseDayId, nowIso(), existing.id,
          );
          updated.push(existing.id);
        }
      }

      if (created.length + updated.length === 0 && !cruiseId) throw new HttpError(400, 'Es wurde nichts zum Übernehmen ausgewählt');

      // 3) File the document under the first item it produced or updated.
      const primary = created[0] ?? updated[0] ?? null;
      db.prepare("UPDATE attachments SET item_id = ?, analysis_status = 'applied', analysis_error = NULL WHERE id = ?").run(
        primary ?? row.item_id, req.params.id,
      );
      touchTrip(db, tripId);
    });

    return { createdItemIds: created, updatedItemIds: updated, cruiseId, attachment: view(req.params.id) };
  });
}

