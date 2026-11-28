/**
 * Admin settings for the AI: keys and models of Claude, ChatGPT and Gemini, which one is the primary, and whether
 * the others step in when it fails. A new key is tested before it is saved. Keys are never returned, only "…abcd".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { describeAiError } from '../ai/anthropic.ts';
import { effective, PROVIDER_LABEL, PROVIDERS, providerStates, readAiConfig, writeAiConfig, type ProviderId } from '../ai/providers.ts';
import { requireAdmin } from '../auth.ts';
import { HttpError } from '../util.ts';

const providerInput = z.object({
  /** string = set (tested first), null = remove the key from the settings (the .env key, if any, applies again) */
  key: z
    .string()
    .trim()
    .min(10, 'Der Schlüssel ist zu kurz.')
    .max(400)
    .regex(/^\S+$/, 'Der Schlüssel darf keine Leerzeichen enthalten.')
    .nullish(),
  /** empty or null = default model */
  model: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9._:\-/]*$/, 'Ungültiger Modellname.')
    .nullish(),
});

const configInput = z.object({
  primary: z.enum(PROVIDERS).optional(),
  fallback: z.boolean().optional(),
  providers: z.object({ anthropic: providerInput.optional(), openai: providerInput.optional(), gemini: providerInput.optional() }).optional(),
});

export function registerAiConfigRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, config, ai } = ctx;

  const view = () => {
    const stored = readAiConfig(db);
    return {
      configurable: ai.configurable,
      primary: stored.primary,
      fallback: stored.fallback,
      providers: providerStates(db, config),
      /** Order in which the providers are tried right now. */
      active: ai.chain().map((m) => ({ id: m.id, label: PROVIDER_LABEL[m.id], model: m.extractor.model })),
    };
  };

  app.get('/api/ai/config', async (req) => {
    requireAdmin(req);
    return view();
  });

  app.put('/api/ai/config', async (req) => {
    requireAdmin(req);
    if (!ai.configurable) throw new HttpError(409, 'Die KI ist in dieser Umgebung fest eingestellt.');
    const input = configInput.parse(req.body ?? {});
    const stored = readAiConfig(db);
    const current = effective(db, config).providers;
    for (const id of PROVIDERS) {
      const p = input.providers?.[id];
      if (!p) continue;
      const next = { ...(stored.providers[id] ?? {}) };
      if (p.model !== undefined) next.model = p.model || null;
      if (p.key === null) next.key = null;
      if (typeof p.key === 'string') {
        // Test the new key with the model that will be used, before anything is saved.
        const model = next.model?.trim() || current[id].model;
        try {
          await ai.factory(id, p.key, model).check();
        } catch (err) {
          throw new HttpError(400, `${PROVIDER_LABEL[id]}: Schlüssel nicht übernommen. ${describeAiError(err)}`);
        }
        next.key = p.key;
      }
      stored.providers[id] = next;
    }
    if (input.primary) stored.primary = input.primary;
    if (input.fallback !== undefined) stored.fallback = input.fallback;
    writeAiConfig(db, stored);
    ai.reload();
    app.log.info(`KI-Einstellungen geändert: ${ai.chain().map((m) => PROVIDER_LABEL[m.id]).join(' → ') || 'keine KI'}`);
    return view();
  });

  /** Checks every provider in the chain; ok when at least one works. 502 with the reasons when none does. */
  app.post('/api/ai/check', async (req) => {
    requireAdmin(req);
    const extractor = ai.current();
    if (!extractor) throw new HttpError(409, 'Keine KI eingerichtet (Einstellungen → KI und Dokumente).');
    const members = ai.chain();
    if (members.length === 0) {
      // Fixed extractor (tests).
      try {
        await extractor.check();
      } catch (err) {
        throw new HttpError(502, describeAiError(err));
      }
      return { ok: true, model: extractor.model, results: [] };
    }
    const results: { id: ProviderId; label: string; model: string; ok: boolean; error: string | null }[] = [];
    for (const m of members) {
      try {
        await m.extractor.check();
        results.push({ id: m.id, label: PROVIDER_LABEL[m.id], model: m.extractor.model, ok: true, error: null });
      } catch (err) {
        results.push({ id: m.id, label: PROVIDER_LABEL[m.id], model: m.extractor.model, ok: false, error: describeAiError(err) });
      }
    }
    const firstOk = results.find((r) => r.ok);
    if (!firstOk) throw new HttpError(502, results.map((r) => `${r.label}: ${r.error}`).join(' · '));
    return { ok: true, model: `${firstOk.label} (${firstOk.model})`, results };
  });
}
