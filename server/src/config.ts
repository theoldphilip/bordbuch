import path from 'node:path';

export interface AppConfig {
  dataDir: string;
  webDir: string | null;
  defaultTz: string;
  maxUploadMb: number;
  /** Enables document analysis when set. Never logged or sent to clients. */
  anthropicApiKey: string | null;
  aiModel: string;
}

export function configFromEnv(): AppConfig & { port: number; host: string } {
  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
    webDir: process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null,
    defaultTz: process.env.DEFAULT_TZ ?? 'Europe/Zurich',
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 25),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    aiModel: process.env.AI_MODEL?.trim() || 'claude-opus-5-5',
  };
}
