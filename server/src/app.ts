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
import { registerReviewRoutes } from './routes/review.ts';
import { registerPushRoutes } from './routes/push.ts';
import { BUILT_AT, VERSION } from './version.ts';
import { registerCertificateRoutes } from './routes/certificate.ts';
import { registerPlaceLookupRoutes } from './routes/placeLookup.ts';
import { createWebPushSender, loadVapid, type PushSender } from './push.ts';
import { apnsConfigFromEnv, createApnsSender, type ApnsSender } from './apns.ts';
import { runReminderTick } from './reminderRunner.ts';
import type { Extractor } from './ai/types.ts';
import { buildChain, chainExtractor, defaultFactory, PROVIDER_LABEL, type ChainMember, type ExtractorFactory } from './ai/providers.ts';
import { registerAiConfigRoutes } from './routes/aiConfig.ts';

export { VERSION };

export interface Ctx {
  db: DB;
  config: AppConfig;
  uploadDir: string;
  /** The AI: current() is null when no provider has a key. reload() after the admin changed keys or providers. */
  ai: AiHub;
  sender: PushSender;
  /** Native iPhone app push; null when no APNs key is configured. */
  apns: ApnsSender | null;
}

export interface AiHub {
  current(): Extractor | null;
  /** The providers in the order they are tried (empty when tests inject a fixed extractor). */
  chain(): ChainMember[];
  reload(): void;
  /** false when tests inject a fixed extractor: then settings do not change it. */
  readonly configurable: boolean;
  readonly factory: ExtractorFactory;
}

export async function buildApp(config: AppConfig, opts: { logger?: boolean; dbFile?: string; backups?: number; extractor?: Extractor | null; aiFactory?: ExtractorFactory; pushSender?: PushSender; apnsSender?: ApnsSender | null; scheduler?: boolean } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const uploadDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(opts.dbFile ?? path.join(config.dataDir, 'bordbuch.db'));
  const factory = opts.aiFactory ?? defaultFactory();
  let current: Extractor | null = null;
  let members: ChainMember[] = [];
  const ai: AiHub =
    opts.extractor !== undefined
      ? { current: () => opts.extractor ?? null, chain: () => [], reload: () => {}, configurable: false, factory }
      : {
          current: () => current,
          chain: () => members,
          reload: () => {
            members = buildChain(db, config, factory);
            current = chainExtractor(members);
          },
          configurable: true,
          factory,
        };
  ai.reload();
  const sender = opts.pushSender ?? createWebPushSender(loadVapid(db, process.env.PUSH_SUBJECT?.trim() || 'mailto:bordbuch@example.com'));
  // APNs: tests pass their own sender (or null); otherwise from the environment. A broken key must not stop the server.
  let apns: ApnsSender | null = null;
  let apnsProblem: string | null = null;
  if (opts.apnsSender !== undefined) apns = opts.apnsSender;
  else {
    const apnsConfig = apnsConfigFromEnv();
    try {
      apns = apnsConfig ? createApnsSender(apnsConfig) : null;
    } catch (err) {
      apnsProblem = `APNs-Schlüssel unbrauchbar, Push für die iPhone-App ist aus: ${(err as Error).message}`;
    }
  }
  const ctx: Ctx = { db, config, uploadDir, ai, sender, apns };

  const app: FastifyInstance = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  if (ai.configurable) {
    const chain = ai.chain();
    app.log.info(chain.length ? `KI aktiv: ${chain.map((m) => `${PROVIDER_LABEL[m.id]} (${m.extractor.model})`).join(' → ')}` : 'KI aus (kein Schlüssel in Einstellungen oder .env)');
  }
  if (apnsProblem) app.log.warn(apnsProblem);
  else if (apns && opts.apnsSender === undefined) app.log.info('APNs eingerichtet: Push für die iPhone-App ist an.');

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

  /** Public: shown in the settings and on the login page, and used to notice an outdated web app. */
  app.get('/api/version', { config: { public: true } }, async () => ({
    version: VERSION,
    builtAt: BUILT_AT,
    schema: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  }));

  registerAuthRoutes(app, ctx);
  registerTripRoutes(app, ctx);
  registerCruiseRoutes(app, ctx);
  registerItemRoutes(app, ctx);
  registerAttachmentRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerPushRoutes(app, ctx);
  registerCertificateRoutes(app, ctx);
  registerPlaceLookupRoutes(app, ctx);
  registerAiConfigRoutes(app, ctx);

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
        runReminderTick({ db, config, sender, apns })
          .catch((err) => app.log.warn({ err }, 'Erinnerungen fehlgeschlagen'))
          .finally(() => (ticking = false));
      }, 30_000)
    : null;
  reminderTimer?.unref();
  app.addHook('onClose', async () => {
    if (reminderTimer) clearInterval(reminderTimer);
    stopBackup();
    apns?.close?.();
    db.close();
  });
  return app;
}
