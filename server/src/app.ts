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

export const VERSION = '0.1.0';

export interface Ctx {
  db: DB;
  config: AppConfig;
  uploadDir: string;
}

export async function buildApp(config: AppConfig, opts: { logger?: boolean; dbFile?: string; backups?: number } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const uploadDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(opts.dbFile ?? path.join(config.dataDir, 'bordbuch.db'));
  const ctx: Ctx = { db, config, uploadDir };

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
  app.addHook('onClose', async () => {
    stopBackup();
    db.close();
  });
  return app;
}
