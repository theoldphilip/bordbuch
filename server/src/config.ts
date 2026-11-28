import path from 'node:path';

export interface AppConfig {
  dataDir: string;
  webDir: string | null;
  defaultTz: string;
  maxUploadMb: number;
  /** Enables document analysis when set. Never logged or sent to clients. */
  anthropicApiKey: string | null;
  aiModel: string;
  /** Optional further AI providers from the environment; keys can also be set in the settings (admin). */
  openaiApiKey?: string | null;
  openaiModel?: string | null;
  geminiApiKey?: string | null;
  geminiModel?: string | null;
  /** Live flight status (AeroDataBox via RapidAPI); can also be set in the settings (admin). */
  flightDataKey?: string | null;
  flightDataHost?: string | null;
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
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
    openaiModel: process.env.OPENAI_MODEL?.trim() || null,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
    geminiModel: process.env.GEMINI_MODEL?.trim() || null,
    flightDataKey: process.env.FLIGHTDATA_API_KEY?.trim() || null,
    flightDataHost: process.env.FLIGHTDATA_HOST?.trim() || null,
  };
}
