import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { ErrorBox } from '../../components/ui.tsx';

interface FlightConfig {
  configurable: boolean;
  configured: boolean;
  source: 'settings' | 'env' | null;
  keyHint: string | null;
  host: string;
  defaultHost: string;
  monthlyLimit: number;
  usedThisMonth: number;
}

/** Admin: key for the live flight status (AeroDataBox via RapidAPI), monthly limit, usage. */
export function FlightStatusAdmin() {
  const [cfg, setCfg] = useState<FlightConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [limit, setLimit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<FlightConfig>('/api/flight-status/config').then(setCfg).catch((e) => setError(errorMessage(e)));
  }, []);

  const put = async (body: unknown, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      setCfg(await api.put<FlightConfig>('/api/flight-status/config', body));
      setNotice({ ok: true, text: done });
      return true;
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return error ? <ErrorBox error={error} /> : null;

  return (
    <section className="card">
      <h3>Live-Flugstatus</h3>
      <p className="muted">
        Für Flüge mit Flugnummer fragt der Server ab 24 h vor Abflug bei <strong>AeroDataBox</strong> Verspätung, Terminal, Schalter, Gate und
        Kofferband ab: weit vorher stündlich, in den letzten 6 h alle 15 min, rund um den Abflug alle 5 min. Neue Angaben landen im Eintrag;
        Verspätungen ab 15 min und Annullierungen kommen als Mitteilung. Gesendet werden nur Flugnummer und Datum.
      </p>
      <p className="muted">
        {cfg.configured
          ? `Eingerichtet (Schlüssel endet auf ${cfg.keyHint?.slice(1)}${cfg.source === 'env' ? ', aus der .env' : ''}). Diesen Monat ${cfg.usedThisMonth} von höchstens ${cfg.monthlyLimit} Abfragen.`
          : 'Nicht eingerichtet. Einen Schlüssel bekommst du auf rapidapi.com: Konto anlegen, die API „AeroDataBox“ abonnieren (es gibt ein kleines Gratis-Kontingent), dann den „X-RapidAPI-Key“ kopieren.'}
      </p>
      {cfg.configurable && (
        <>
          <label className="field">
            <span className="field-label">{cfg.configured ? 'Neuer Schlüssel' : 'RapidAPI-Schlüssel'}</span>
            <input type="password" autoComplete="off" spellCheck={false} value={key} placeholder="wird vor dem Speichern geprüft" onChange={(e) => setKey(e.target.value)} />
          </label>
          <div className="row-buttons">
            <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={async () => (await put({ key: key.trim() }, 'Schlüssel geprüft und gespeichert.')) && setKey('')}>
              {busy ? 'Prüft…' : 'Prüfen und speichern'}
            </button>
            {cfg.source === 'settings' && (
              <button className="btn btn-danger-ghost" disabled={busy} onClick={() => confirm('Schlüssel für den Flugstatus entfernen?') && put({ key: null }, 'Schlüssel entfernt.')}>
                Schlüssel entfernen
              </button>
            )}
          </div>
          <label className="field">
            <span className="field-label">Höchstens Abfragen pro Monat (Standard 500)</span>
            <input inputMode="numeric" value={limit || String(cfg.monthlyLimit)} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
          </label>
          <div>
            <button className="btn btn-ghost" disabled={busy || !limit} onClick={() => put({ monthlyLimit: Number(limit) }, 'Grenze gespeichert.')}>Grenze speichern</button>
          </div>
          <p className="muted small-print">Ein Flug braucht etwa 50 bis 70 Abfragen. Ist die Grenze erreicht, fragt der Server bis Monatsende nichts mehr ab.</p>
        </>
      )}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`}>{notice.text}</div>}
    </section>
  );
}
