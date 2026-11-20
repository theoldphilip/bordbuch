import { buildApp } from './app.ts';
import { configFromEnv } from './config.ts';

const config = configFromEnv();
const app = await buildApp(config, { logger: true, backups: Number(process.env.BACKUP_KEEP ?? 14) });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} empfangen, beende…`);
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(config.anthropicApiKey ? `Dokument-Analyse aktiv (Modell ${config.aiModel})` : 'Dokument-Analyse aus (ANTHROPIC_API_KEY nicht gesetzt)');
app.log.info(`Daten: ${config.dataDir} · Web: ${config.webDir ?? '(nicht ausgeliefert)'} · Standard-Zeitzone: ${config.defaultTz}`);
