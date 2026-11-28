import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { ErrorBox } from '../../components/ui.tsx';

type ProviderId = 'anthropic' | 'openai' | 'gemini';
interface ProviderState {
  id: ProviderId;
  label: string;
  configured: boolean;
  source: 'settings' | 'env' | null;
  keyHint: string | null;
  model: string;
  defaultModel: string;
}
interface AiConfig {
  configurable: boolean;
  primary: ProviderId;
  fallback: boolean;
  providers: ProviderState[];
  active: { id: ProviderId; label: string; model: string }[];
}
interface CheckResult {
  model: string;
  results: { id: ProviderId; label: string; model: string; ok: boolean; error: string | null }[];
}

const WHERE: Record<ProviderId, { site: string; hint: string }> = {
  anthropic: { site: 'console.anthropic.com', hint: 'Settings → API Keys' },
  openai: { site: 'platform.openai.com', hint: 'API keys' },
  gemini: { site: 'aistudio.google.com', hint: 'Get API key' },
};

/** Admin: keys and models of Claude, ChatGPT and Gemini, primary provider and fallback, connection test. */
export function AiAdmin() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [models, setModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);

  useEffect(() => {
    api.get<AiConfig>('/api/ai/config').then(setCfg).catch((e) => setError(errorMessage(e)));
  }, []);

  const put = async (body: unknown, what: string, done: string) => {
    setBusy(what);
    setNotice(null);
    setCheck(null);
    try {
      setCfg(await api.put<AiConfig>('/api/ai/config', body));
      setNotice({ ok: true, text: done });
      return true;
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (p: ProviderState) => {
    const key = keys[p.id]?.trim();
    if (!key) return;
    if (await put({ providers: { [p.id]: { key } } }, `key-${p.id}`, `${p.label}: Schlüssel geprüft und gespeichert.`)) setKeys((k) => ({ ...k, [p.id]: '' }));
  };
  const removeKey = (p: ProviderState) => {
    if (!confirm(`Schlüssel von ${p.label} aus den Einstellungen entfernen?`)) return;
    void put({ providers: { [p.id]: { key: null } } }, `key-${p.id}`, `${p.label}: Schlüssel entfernt.`);
  };
  const saveModel = (p: ProviderState) => {
    const model = models[p.id]?.trim() ?? '';
    void put({ providers: { [p.id]: { model: model || null } } }, `model-${p.id}`, `${p.label}: Modell ${model || p.defaultModel} eingestellt.`);
  };

  const test = async () => {
    setBusy('check');
    setNotice(null);
    setCheck(null);
    try {
      setCheck(await api.post<CheckResult>('/api/ai/check'));
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!cfg) return error ? <ErrorBox error={error} /> : null;
  const configured = cfg.providers.filter((p) => p.configured);

  return (
    <>
      <section className="card">
        <h3>KI für Dokumente, Recherche und Prüfen</h3>
        {cfg.active.length ? (
          <p className="muted">
            Aktiv: <strong>{cfg.active.map((a) => `${a.label} (${a.model})`).join(' → ')}</strong>.
            {cfg.active.length > 1 ? ' Fällt der erste aus (Fehler, Limit, kein Guthaben), springt der nächste ein.' : ''} Hochgeladene Dokumente und
            die Daten für Recherche und Prüfen gehen an diesen Anbieter.
          </p>
        ) : (
          <p className="muted">Keine KI eingerichtet. Trage unten mindestens einen Schlüssel ein.</p>
        )}
        {!cfg.configurable && <p className="muted">In dieser Umgebung ist die KI fest eingestellt.</p>}
        <label className="field">
          <span className="field-label">Hauptanbieter</span>
          <select value={cfg.primary} disabled={!cfg.configurable || !!busy} onChange={(e) => put({ primary: e.target.value }, 'primary', 'Hauptanbieter geändert.')}>
            {cfg.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.configured ? '' : ' (kein Schlüssel)'}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={cfg.fallback} disabled={!cfg.configurable || !!busy} onChange={(e) => put({ fallback: e.target.checked }, 'fallback', e.target.checked ? 'Ausweich ist an.' : 'Ausweich ist aus.')} />
          Ausweich: bei einem Fehler die anderen Anbieter mit Schlüssel versuchen
        </label>
        <div>
          <button className="btn" onClick={test} disabled={!!busy || configured.length === 0}>{busy === 'check' ? 'Prüft…' : 'Verbindung testen'}</button>
        </div>
        {check && (
          <ul className="plain-list">
            {check.results.map((r) => (
              <li key={r.id} className={r.ok ? '' : 'text-error'}>
                {r.ok ? '✓' : '✗'} {r.label} ({r.model}){r.ok ? ': Verbindung steht.' : `: ${r.error}`}
              </li>
            ))}
            {check.results.length === 0 && <li>✓ Verbindung steht ({check.model}).</li>}
          </ul>
        )}
        {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`}>{notice.text}</div>}
      </section>

      {cfg.providers.map((p) => (
        <section className="card" key={p.id}>
          <h3>{p.label}</h3>
          <p className="muted">
            {p.configured
              ? `Schlüssel eingerichtet (endet auf ${p.keyHint?.slice(1)}${p.source === 'env' ? ', aus der .env auf dem Server' : ''}).`
              : `Kein Schlüssel. Einen API-Schlüssel bekommst du auf ${WHERE[p.id].site} unter „${WHERE[p.id].hint}“.`}
          </p>
          {cfg.configurable && (
            <>
              <label className="field">
                <span className="field-label">{p.configured ? 'Neuer Schlüssel' : 'API-Schlüssel'}</span>
                <input type="password" autoComplete="off" spellCheck={false} value={keys[p.id] ?? ''} placeholder="wird vor dem Speichern geprüft" onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} />
              </label>
              <div className="row-buttons">
                <button className="btn btn-primary" onClick={() => saveKey(p)} disabled={!!busy || !keys[p.id]?.trim()}>{busy === `key-${p.id}` ? 'Prüft…' : 'Prüfen und speichern'}</button>
                {p.source === 'settings' && <button className="btn btn-danger-ghost" onClick={() => removeKey(p)} disabled={!!busy}>Schlüssel entfernen</button>}
              </div>
              <label className="field">
                <span className="field-label">Modell (leer = {p.defaultModel})</span>
                <input value={models[p.id] ?? (p.model === p.defaultModel ? '' : p.model)} placeholder={p.defaultModel} spellCheck={false} onChange={(e) => setModels((m) => ({ ...m, [p.id]: e.target.value }))} />
              </label>
              <div>
                <button className="btn btn-ghost" onClick={() => saveModel(p)} disabled={!!busy || models[p.id] === undefined}>Modell speichern</button>
              </div>
            </>
          )}
        </section>
      ))}
      <p className="muted small-print">
        Schlüssel werden auf dem Server in der Datenbank gespeichert (auch in den täglichen Backups) und nie wieder angezeigt. Gib sie nur über die
        verschlüsselte Verbindung ein (VPN oder https://…:8444).
      </p>
    </>
  );
}
