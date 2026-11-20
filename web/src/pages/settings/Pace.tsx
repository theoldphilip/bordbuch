import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import type { Pace, UserSettings } from '../../types.ts';
import { ErrorBox } from '../../components/ui.tsx';

const FACTORS = [1.25, 1.5, 1.75, 2, 2.5, 3];

/** Recommended times are multiplied by a personal factor. Always shown next to the normal time. */
export function PaceSettings() {
  const [pace, setPace] = useState<Pace | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<UserSettings>('/api/me/settings').then((s) => setPace(s.pace)).catch((e) => setError(errorMessage(e)));
  }, []);

  const save = async (next: Pace) => {
    setPace(next);
    setSaved(false);
    setError(null);
    try {
      setPace((await api.patch<UserSettings>('/api/me/settings', { pace: next })).pace);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!pace) return error ? <ErrorBox error={error} /> : null;
  const example = Math.ceil((30 * pace.factor + pace.extraMinutes) / 5) * 5;

  return (
    <section className="card">
      <h3>Persönlicher Zeitbedarf</h3>
      <p className="muted">
        Für Wege, Ein- und Ausstiege, Transfers und Check-ins, bei denen du mehr Zeit brauchst als üblich. Alle empfohlenen Mindestzeiten
        (Anreise zum Schiff, Ausschiffung, Rückkehr von Ausflügen, Hotel-Check-out) werden dann mit deinem Faktor gerechnet. Angezeigt
        werden immer <strong>beide Zeiten</strong>: normal und persönlich. Die Einstellung gilt nur für dein Konto.
      </p>
      <label className="check">
        <input type="checkbox" checked={pace.enabled} onChange={(e) => save({ ...pace, enabled: e.target.checked })} />
        Persönlichen Zeitbedarf berücksichtigen
      </label>
      <div className="form" style={{ opacity: pace.enabled ? 1 : 0.55 }}>
        <label className="field">
          <span className="field-label">Faktor</span>
          <select value={pace.factor} disabled={!pace.enabled} onChange={(e) => save({ ...pace, factor: Number(e.target.value) })}>
            {[...new Set([...FACTORS, pace.factor])].sort((a, b) => a - b).map((f) => <option key={f} value={f}>× {String(f).replace('.', ',')}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Zusatzzeit pauschal</span>
          <select value={pace.extraMinutes} disabled={!pace.enabled} onChange={(e) => save({ ...pace, extraMinutes: Number(e.target.value) })}>
            {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? 'keine' : `+ ${m} min`}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small-print">Beispiel: Aus einer empfohlenen Zeit von 30 min werden <strong>{pace.enabled ? `${example} min` : '30 min (aus)'}</strong>.</p>
      {saved && <div className="alert alert-ok">Gespeichert.</div>}
      <ErrorBox error={error} />
    </section>
  );
}
