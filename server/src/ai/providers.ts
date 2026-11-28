/**
 * Which AI provider does the work: Claude, ChatGPT or Gemini. Keys and models are set by an admin in the settings
 * (stored in the table meta, never returned in full) or come from the environment (.env). One provider is the
 * primary; with fallback on, the others with a key step in when it fails (error, limit, no credit).
 */
import type { DB } from '../db.ts';
import type { AppConfig } from '../config.ts';
import { createAnthropicExtractor, describeAiError } from './anthropic.ts';
import { createGeminiExtractor } from './gemini.ts';
import { createOpenAIExtractor, type FetchFn } from './openai.ts';
import { ExtractionError, type Extractor } from './types.ts';

export const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };
export const DEFAULT_MODEL: Record<ProviderId, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-5', gemini: 'gemini-2.5-pro' };

export interface StoredAiConfig {
  primary: ProviderId;
  fallback: boolean;
  providers: Partial<Record<ProviderId, { key?: string | null; model?: string | null }>>;
}

export interface ProviderState {
  id: ProviderId;
  label: string;
  configured: boolean;
  /** Where the key comes from: the settings or the .env file. */
  source: 'settings' | 'env' | null;
  /** Last four characters, so the admin can tell keys apart. Never the key itself. */
  keyHint: string | null;
  model: string;
  defaultModel: string;
}

const META_KEY = 'ai_config';

export function readAiConfig(db: DB): StoredAiConfig {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  const base: StoredAiConfig = { primary: 'anthropic', fallback: true, providers: {} };
  if (!row) return base;
  try {
    const v = JSON.parse(row.value) as Partial<StoredAiConfig>;
    return {
      primary: PROVIDERS.includes(v.primary as ProviderId) ? (v.primary as ProviderId) : 'anthropic',
      fallback: v.fallback !== false,
      providers: v.providers && typeof v.providers === 'object' ? v.providers : {},
    };
  } catch {
    return base;
  }
}

export function writeAiConfig(db: DB, config: StoredAiConfig): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_KEY, JSON.stringify(config));
}

export function envKeys(config: AppConfig): Record<ProviderId, { key: string | null; model: string | null }> {
  return {
    anthropic: { key: config.anthropicApiKey, model: config.aiModel || null },
    openai: { key: config.openaiApiKey ?? null, model: config.openaiModel ?? null },
    gemini: { key: config.geminiApiKey ?? null, model: config.geminiModel ?? null },
  };
}

/** Effective key and model per provider: settings first, then .env, then the default model. */
export function effective(db: DB, config: AppConfig): { stored: StoredAiConfig; providers: Record<ProviderId, { key: string | null; model: string; source: ProviderState['source'] }> } {
  const stored = readAiConfig(db);
  const env = envKeys(config);
  const providers = {} as Record<ProviderId, { key: string | null; model: string; source: ProviderState['source'] }>;
  for (const id of PROVIDERS) {
    const s = stored.providers[id] ?? {};
    const key = s.key?.trim() || env[id].key?.trim() || null;
    providers[id] = { key, model: s.model?.trim() || env[id].model?.trim() || DEFAULT_MODEL[id], source: s.key?.trim() ? 'settings' : env[id].key?.trim() ? 'env' : null };
  }
  return { stored, providers };
}

export function providerStates(db: DB, config: AppConfig): ProviderState[] {
  const { providers } = effective(db, config);
  return PROVIDERS.map((id) => ({
    id,
    label: PROVIDER_LABEL[id],
    configured: !!providers[id].key,
    source: providers[id].source,
    keyHint: providers[id].key ? `…${providers[id].key!.slice(-4)}` : null,
    model: providers[id].model,
    defaultModel: DEFAULT_MODEL[id],
  }));
}

export type ExtractorFactory = (id: ProviderId, key: string, model: string) => Extractor;

export const defaultFactory = (fetchFn?: FetchFn): ExtractorFactory => (id, key, model) =>
  id === 'anthropic' ? createAnthropicExtractor({ apiKey: key, model }) : id === 'openai' ? createOpenAIExtractor({ apiKey: key, model, fetch: fetchFn }) : createGeminiExtractor({ apiKey: key, model, fetch: fetchFn });

export interface ChainMember {
  id: ProviderId;
  extractor: Extractor;
}

/** Primary first, then (with fallback on) the other providers that have a key, in the fixed order. */
export function buildChain(db: DB, config: AppConfig, factory: ExtractorFactory): ChainMember[] {
  const { stored, providers } = effective(db, config);
  const order = [stored.primary, ...PROVIDERS.filter((p) => p !== stored.primary)];
  const withKey = order.filter((id) => providers[id].key);
  const chosen = stored.fallback ? withKey : withKey.filter((id) => id === stored.primary);
  return chosen.map((id) => ({ id, extractor: factory(id, providers[id].key!, providers[id].model) }));
}

/**
 * One extractor over the chain: each call goes to the first provider; if it fails, to the next. The error of every
 * provider that was tried ends up in the message, so the admin sees why (key, limit, outage). `model` names the
 * provider and model that answered last.
 */
export function chainExtractor(chain: ChainMember[]): Extractor | null {
  if (chain.length === 0) return null;
  let last = chain[0]!;
  const label = (m: ChainMember) => `${PROVIDER_LABEL[m.id]} (${m.extractor.model})`;

  async function run<T>(pick: (e: Extractor) => ((...a: any[]) => Promise<T>) | undefined, args: unknown[]): Promise<T> {
    const errors: string[] = [];
    for (const m of chain) {
      const fn = pick(m.extractor);
      if (!fn) continue;
      try {
        const out = await fn.apply(m.extractor, args);
        last = m;
        return out;
      } catch (err) {
        const msg = describeAiError(err);
        errors.push(msg.startsWith(PROVIDER_LABEL[m.id]) ? msg : `${PROVIDER_LABEL[m.id]}: ${msg}`);
      }
    }
    if (errors.length === 0) throw new ExtractionError('Keine KI für diese Funktion eingerichtet.');
    throw new ExtractionError(errors.length === 1 ? errors[0]!.replace(/^(Claude|ChatGPT|Gemini): /, '') : errors.join(' · '));
  }

  const has = (k: keyof Extractor) => chain.some((m) => typeof m.extractor[k] === 'function');
  const ext: Extractor = {
    get model() {
      return label(last);
    },
    extract: (input) => run((e) => e.extract, [input]),
    check: () => run((e) => e.check, []),
  };
  if (has('research')) ext.research = (input) => run((e) => e.research, [input]);
  if (has('review')) ext.review = (input) => run((e) => e.review, [input]);
  if (has('lookupPlace')) ext.lookupPlace = (input) => run((e) => e.lookupPlace, [input]);
  return ext;
}
