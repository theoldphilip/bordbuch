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
import { acceptSuggestions } from '../ai/research.ts';
import { buildProposals, findDay, mergeItem } from '../ai/proposals.ts';
import { ExtractionError, type ExtractionContext, type ItemData, type NormalizedExtraction, type ResearchData } from '../ai/types.ts';
import { requireAdmin, requireTripRole, requireUser } from '../auth.ts';
import { tx } from '../db.ts';
import { attachmentFromRow, itemFromRow, loadCruises, loadItems, loadTrip, touchTrip } from '../model.ts';
import { cruiseCreateInput, cruiseDayInput, cruiseInput, infoList, itemInput, mergeInfos } from '../schemas.ts';
import { HttpError, newId, nowIso } from '../util.ts';
import { receiveUpload } from './attachments.ts';
import { normalizePayment } from '../costs.ts';
import { insertCruise, insertDay, updateCruise } from './cruises.ts';
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

/** Optional start options: what to research and a page to read first (only http/https, the model reads it, not this server). */
const researchStartInput = z.object({
  mode: z.enum(['gaps', 'route']).default('gaps'),
  url: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'Nur Internetadressen mit http oder https')
    .nullish()
    .transform((v) => v || null),
});

type Row = Record<string, any>;

export function registerDocumentRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, uploadDir, extractor, config } = ctx;

  // A restart can interrupt a running analysis; don't leave it "pending" forever.
  db.prepare(
    `UPDATE attachments SET analysis_status = 'failed', analysis_error = 'Die Analyse wurde unterbrochen. Bitte erneut starten.'
      WHERE analysis_status = 'pending'`,
  ).run();

  // The same for a web research that was running when the server stopped.
  for (const r of db.prepare(`SELECT id, analysis FROM attachments WHERE analysis_status = 'done' AND analysis LIKE '%"status":"pending"%'`).all() as Row[]) {
    try {
      const a = JSON.parse(r.analysis) as NormalizedExtraction;
      if (a.research?.status === 'pending') {
        a.research = { ...a.research, status: 'failed', error: 'Die Recherche wurde unterbrochen. Bitte erneut starten.', finishedAt: new Date().toISOString() };
        db.prepare('UPDATE attachments SET analysis = ? WHERE id = ?').run(JSON.stringify(a), r.id);
      }
    } catch {
      /* leave it alone */
    }
  }

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
      tripKind: trip.kind,
      ships: loadCruises(db, tripId).map((c) => c.shipName),
      cruiseDays: loadCruises(db, tripId).flatMap((c) =>
        c.days.map((d) => ({ id: d.id, date: d.date, kind: d.kind, portName: d.portName, country: d.country, shipName: c.shipName })),
      ),
    };
  }

  /** Files that were analysed together with this one (see POST .../documents/group). */
  const groupMembers = (leadId: string, tripId: string): Row[] =>
    db
      .prepare("SELECT * FROM attachments WHERE trip_id = ? AND analysis_status = 'grouped' AND analysis LIKE ? ORDER BY created_at, id")
      .all(tripId, `%"groupLead":"${leadId}"%`) as Row[];

  /** Runs the analysis and stores the result. Never throws: failures are stored on the attachment. */
  async function analyze(id: string): Promise<void> {
    const row = attachmentRow(id);
    if (!extractor) return;
    if (!classifyFile(row.mime, row.filename)) return;
    setStatus(id, 'pending');
    try {
      const rows = [row, ...groupMembers(id, row.trip_id)];
      const files = rows.map((r) => ({ data: fs.readFileSync(path.join(uploadDir, r.stored_name)), mime: r.mime as string, filename: r.filename as string }));
      const context = contextFor(row.trip_id);
      const ai = await extractor.extract({ files, context });
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

  /**
   * Excursions without a port day are linked to the one port day on their date. Documents arrive in any
   * order (an excursion voucher can be applied before the cruise itself), so this runs after every apply.
   */
  function linkExcursions(tripId: string): void {
    const byDate = new Map<string, string[]>();
    for (const c of loadCruises(db, tripId)) {
      for (const d of c.days) if (d.kind === 'port') byDate.set(d.date, [...(byDate.get(d.date) ?? []), d.id]);
    }
    const open = db.prepare("SELECT id, start_local FROM items WHERE trip_id = ? AND type = 'excursion' AND cruise_day_id IS NULL").all(tripId) as Row[];
    for (const row of open) {
      const days = byDate.get(String(row.start_local).slice(0, 10));
      if (days?.length === 1) db.prepare('UPDATE items SET cruise_day_id = ? WHERE id = ?').run(days[0], row.id);
    }
  }

  // ----- status & key check -----
  app.get('/api/ai/status', async () => ({ enabled: !!extractor, model: extractor?.model ?? null, research: typeof extractor?.research === 'function', review: typeof extractor?.review === 'function', placeLookup: typeof extractor?.lookupPlace === 'function' }));

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

  /**
   * Analyses several already uploaded files together, as one document (e.g. three screenshots of one
   * booking page). The first id leads: it carries the proposals, the others are hidden from the inbox
   * and follow the lead when it is applied or dismissed.
   */
  app.post<{ Params: { tripId: string } }>('/api/trips/:tripId/documents/group', async (req) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    if (!extractor) throw new HttpError(409, 'Die Dokument-Analyse ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    const { attachmentIds } = z.object({ attachmentIds: z.array(z.string()).min(2).max(10) }).parse(req.body);
    const ids = [...new Set(attachmentIds)];
    const rows = ids.map((id) => {
      const r = db.prepare('SELECT * FROM attachments WHERE id = ? AND trip_id = ?').get(id, tripId) as Row | undefined;
      if (!r) throw new HttpError(400, 'Ein Dokument gehört nicht zu dieser Reise');
      if (!classifyFile(r.mime, r.filename)) throw new HttpError(400, `„${r.filename}“ kann nicht automatisch gelesen werden (unterstützt: PDF, Bilder, E-Mail/Text).`);
      if (r.analysis_status === 'pending') throw new HttpError(409, 'Eines der Dokumente wird gerade analysiert.');
      return r;
    });
    const lead = rows[0]!.id as string;
    tx(db, () => {
      for (const m of rows.slice(1)) {
        db.prepare("UPDATE attachments SET analysis_status = 'grouped', analysis = ?, analysis_error = NULL WHERE id = ?").run(JSON.stringify({ groupLead: lead }), m.id);
      }
      db.prepare('UPDATE attachments SET analysis = NULL WHERE id = ?').run(lead);
    });
    await analyze(lead);
    return { attachment: view(lead), memberIds: rows.slice(1).map((r) => r.id as string) };
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
      files: [row, ...groupMembers(req.params.id, row.trip_id)].map((r) => ({ id: r.id as string, filename: r.filename as string })),
      research: normalized.research ?? null,
      ...buildProposals(normalized, { items: loadItems(db, row.trip_id), cruises: loadCruises(db, row.trip_id) }),
    };
  });

  // ----- optional web research for gaps (runs in the background, shown for review first) -----
  const readAnalysis = (row: Row): NormalizedExtraction => {
    if (row.analysis_status !== 'done' || !row.analysis) throw new HttpError(409, 'Für dieses Dokument liegt keine offene Analyse vor');
    return JSON.parse(row.analysis) as NormalizedExtraction;
  };
  const saveResearch = (id: string, research: ResearchData | undefined) => {
    // Re-read: the analysis may have been applied, dismissed or redone while the research was running.
    const row = attachmentRow(id);
    if (row.analysis_status !== 'done' || !row.analysis) return;
    const a = JSON.parse(row.analysis) as NormalizedExtraction;
    if (research) a.research = research;
    else delete a.research;
    db.prepare('UPDATE attachments SET analysis = ? WHERE id = ?').run(JSON.stringify(a), id);
  };

  app.get<{ Params: { id: string } }>('/api/attachments/:id/research', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'viewer');
    return { research: readAnalysis(row).research ?? null };
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/research', async (req, reply) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    if (!extractor?.research) throw new HttpError(409, 'Die Recherche ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    const analysis = readAnalysis(row);
    if (analysis.research?.status === 'pending') throw new HttpError(409, 'Die Recherche läuft bereits.');
    const { mode, url } = researchStartInput.parse(req.body ?? {});
    const startedAt = nowIso();
    saveResearch(row.id, { status: 'pending', startedAt, suggestions: [], mode, url });
    const context = contextFor(row.trip_id);
    const { research } = extractor;
    void (async () => {
      try {
        const out = await research.call(extractor, { analysis: { ...analysis, research: undefined }, context, mode, url });
        saveResearch(row.id, {
          status: 'done', startedAt, finishedAt: nowIso(), summary: out.summary, searches: out.searches, model: extractor.model, mode, url, diagnostics: out.diagnostics,
          suggestions: out.suggestions.map((s) => ({ ...s, id: newId() })),
        });
      } catch (err) {
        app.log.warn({ err }, 'Recherche fehlgeschlagen');
        saveResearch(row.id, { status: 'failed', startedAt, finishedAt: nowIso(), error: describeAiError(err), suggestions: [], mode, url });
      }
    })();
    return reply.status(202).send({ research: { status: 'pending', startedAt, suggestions: [], mode, url } });
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/research/accept', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(100) }).parse(req.body);
    const analysis = readAnalysis(row);
    const n = acceptSuggestions(analysis, ids);
    if (n === 0) throw new HttpError(400, 'Es wurde nichts zum Übernehmen ausgewählt');
    db.prepare('UPDATE attachments SET analysis = ? WHERE id = ?').run(JSON.stringify(analysis), row.id);
    return { accepted: n };
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/research/dismiss', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    readAnalysis(row);
    saveResearch(row.id, undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/attachments/:id/dismiss', async (req) => {
    const user = requireUser(req);
    const row = attachmentRow(req.params.id);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    setStatus(req.params.id, 'dismissed');
    for (const m of groupMembers(req.params.id, row.trip_id)) db.prepare("UPDATE attachments SET analysis_status = 'dismissed', analysis = NULL WHERE id = ?").run(m.id);
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
        insertCruise(db, cruiseId, tripId, data);
        for (const d of data.days) insertDay(db, cruiseId, d);
        db.prepare("UPDATE trips SET kind = 'cruise' WHERE id = ?").run(tripId);
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
          infos: mergeInfos(existing.infos, infoList.parse(c.data.infos ?? [])),
          // Price and payment state from the document only fill gaps; what the user already entered stays.
          cost: existing.cost ?? (c.data.cost as number | null) ?? null,
          currency: existing.cost != null ? existing.currency : ((c.data.currency as string | null) ?? existing.currency),
          ...(existing.paymentStatus
            ? { paymentStatus: existing.paymentStatus, paidAmount: existing.paidAmount, dueDate: existing.dueDate }
            : {
                paymentStatus: (c.data.paymentStatus as string | null) ?? null,
                paidAmount: (c.data.paidAmount as number | null) ?? null,
                dueDate: (c.data.dueDate as string | null) ?? existing.dueDate,
              }),
        });
        updateCruise(db, existing.id, patch);
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
            tender: d.tender || same.tender, notes: same.notes ?? d.notes, infos: mergeInfos(same.infos, d.infos),
          };
          db.prepare(
            `UPDATE cruise_days SET date = ?, kind = ?, port_name = ?, country = ?, timezone = ?, arrival = ?, departure = ?,
                    all_aboard = ?, tender = ?, notes = ?, infos = ? WHERE id = ?`,
          ).run(m.date, m.kind, m.portName, m.country, m.timezone, m.arrival, m.departure, m.allAboard, m.tender ? 1 : 0, m.notes, JSON.stringify(m.infos), same.id);
        }
      }

      // 2) Items
      for (const entry of input.items) {
        if (entry.action === 'skip') continue;
        if (entry.action === 'create') {
          const data = normalizePayment(itemInput.parse(entry.data));
          checkCruiseDay(db, tripId, data.cruiseDayId);
          const id = newId();
          const now = nowIso();
          db.prepare(
            `INSERT INTO items (id, trip_id, type, title, start_local, start_tz, end_local, end_tz, location, confirmation, provider,
                                cost, currency, payment_status, paid_amount, due_date, notes, details, cruise_day_id, infos, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id, tripId, data.type, data.title, data.startLocal, data.startTz, data.endLocal, data.endTz, data.location,
            data.confirmation, data.provider, data.cost, data.currency, data.paymentStatus, data.paidAmount, data.dueDate,
            data.notes, JSON.stringify(data.details), data.cruiseDayId, JSON.stringify(data.infos), now, now,
          );
          created.push(id);
        } else {
          const existingRow = db.prepare('SELECT * FROM items WHERE id = ? AND trip_id = ?').get(entry.itemId ?? '', tripId) as Row | undefined;
          if (!existingRow) throw new HttpError(400, 'Der zu aktualisierende Eintrag gehört nicht zu dieser Reise');
          const existing = itemFromRow(existingRow);
          const base: ItemData = {
            type: existing.type, title: existing.title, startLocal: '', startTz: null, endLocal: null, endTz: null, location: null,
            confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details: {}, infos: [],
          };
          const merged = normalizePayment(itemInput.parse(mergeItem(existing, { ...base, ...(entry.data as Partial<ItemData>) })));
          checkCruiseDay(db, tripId, merged.cruiseDayId);
          db.prepare(
            `UPDATE items SET title = ?, start_local = ?, start_tz = ?, end_local = ?, end_tz = ?, location = ?, confirmation = ?,
                    provider = ?, cost = ?, currency = ?, payment_status = ?, paid_amount = ?, due_date = ?, notes = ?, details = ?,
                    cruise_day_id = ?, infos = ?, updated_at = ? WHERE id = ?`,
          ).run(
            merged.title, merged.startLocal, merged.startTz, merged.endLocal, merged.endTz, merged.location, merged.confirmation,
            merged.provider, merged.cost, merged.currency, merged.paymentStatus, merged.paidAmount, merged.dueDate,
            merged.notes, JSON.stringify(merged.details), merged.cruiseDayId, JSON.stringify(merged.infos), nowIso(), existing.id,
          );
          updated.push(existing.id);
        }
      }

      if (created.length + updated.length === 0 && !cruiseId) throw new HttpError(400, 'Es wurde nichts zum Übernehmen ausgewählt');

      linkExcursions(tripId);

      // Several stations make it a round trip (a trip created with "automatic" starts as city trip).
      const stops = (db.prepare("SELECT count(*) AS n FROM items WHERE trip_id = ? AND type = 'stop'").get(tripId) as { n: number }).n;
      if (stops >= 2) db.prepare("UPDATE trips SET kind = 'roundtrip' WHERE id = ? AND kind = 'city'").run(tripId);

      // 3) File the document under the first item it produced or updated.
      const primary = created[0] ?? updated[0] ?? null;
      for (const m of groupMembers(req.params.id, tripId)) {
        db.prepare("UPDATE attachments SET item_id = ?, analysis_status = 'applied', analysis = NULL WHERE id = ?").run(primary ?? m.item_id, m.id);
      }
      db.prepare("UPDATE attachments SET item_id = ?, analysis_status = 'applied', analysis_error = NULL WHERE id = ?").run(
        primary ?? row.item_id, req.params.id,
      );
      touchTrip(db, tripId);
    });

    return { createdItemIds: created, updatedItemIds: updated, cruiseId, attachment: view(req.params.id) };
  });
}

