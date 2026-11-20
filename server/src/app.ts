import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AppConfig } from './config.ts';
import { openDb, type DB } from './db.ts';
import { authenticate } from './auth.ts';
import { startDailyBackup } from './backup.ts';
import { HttpError } from './util.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerTripRoutes } from './routes/trips.ts';
import { registerCruiseRoutes } from './routes/cruises.ts';
import { registerItemRoutes } from './routes/items.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerDocumentRoutes } from './routes/documents.ts';
import { registerPushRoutes } from './routes/push.ts';
import { createWebPushSender, loadVapid, type PushSender } from './push.ts';
import { runReminderTick } from './reminderRunner.ts';
import { createAnthropicExtractor } from './ai/anthropic.ts';
import type { Extractor } from './ai/types.ts';

export const VERSION = '0.1.0';

export interface Ctx {
  db: DB;
  config: AppConfig;
  uploadDir: string;
  /** null = document analysis is not set up (no API key). */
  extractor: Extractor | null;
  sender: PushSender;
}

export async function buildApp(config: AppConfig, opts: { logger?: boolean; dbFile?: string; backups?: number; extractor?: Extractor | null; pushSender?: PushSender; scheduler?: boolean } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const uploadDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(opts.dbFile ?? path.join(config.dataDir, 'bordbuch.db'));
  const extractor =
    opts.extractor !== undefined
      ? opts.extractor
      : config.anthropicApiKey
        ? createAnthropicExtractor({ apiKey: config.anthropicApiKey, model: config.aiModel })
        : null;
  const sender = opts.pushSender ?? createWebPushSender(loadVapid(db, process.env.PUSH_SUBJECT?.trim() || 'mailto:bordbuch@example.com'));
  const ctx: Ctx = { db, config, uploadDir, extractor, sender };

  const app: FastifyInstance = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  app.decorateRequest('user', null);
  app.decorateRequest('tokenHash', null);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.routeOptions.config?.public) return;
    authenticate(db, req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'Ungültige Eingabe',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Interner Serverfehler' });
  });

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true, version: VERSION }));

  registerAuthRoutes(app, ctx);
  registerTripRoutes(app, ctx);
  registerCruiseRoutes(app, ctx);
  registerItemRoutes(app, ctx);
  registerAttachmentRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  registerPushRoutes(app, ctx);

  // Web app (PWA) with SPA fallback.
  const webDir = config.webDir;
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.status(404).send({ error: 'Nicht gefunden' });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Nicht gefunden' }));
  }

  const stopBackup = opts.backups ? startDailyBackup(db, config.dataDir, opts.backups, (m) => app.log.info(m)) : () => {};
  let ticking = false;
  const reminderTimer = opts.scheduler
    ? setInterval(() => {
        if (ticking) return;
        ticking = true;
        runReminderTick({ db, config, sender })
          .catch((err) => app.log.warn({ err }, 'Erinnerungen fehlgeschlagen'))
          .finally(() => (ticking = false));
      }, 30_000)
    : null;
  reminderTimer?.unref();
  app.addHook('onClose', async () => {
    if (reminderTimer) clearInterval(reminderTimer);
    stopBackup();
    db.close();
  });
  return app;
}
