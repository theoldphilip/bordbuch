import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import type { Item, PlaceLookup } from '../types.ts';
import { ErrorBox } from './ui.tsx';

/** Which entries have something to look up on the day, and how the button is labelled. */
export const LOOKUP_LABEL: Partial<Record<Item['type'], string>> = {
  flight: 'Terminal, Schalter, Gate, Kofferband abfragen',
  train: 'Gleis abfragen',
  car_rental: 'Schalter abfragen',
};

/**
 * Day-of-travel lookup for one entry: the server searches live pages (airport, airline, railway) for exactly this
 * flight or train and returns what it found, each value with its source. Nothing is saved until "Übernehmen".
 * Works in view mode too, like acknowledging hints: on the travel day this is what you need.
 */
export function PlaceLookupPanel({ item, onApplied }: { item: Item; onApplied: () => void }) {
  const [lookup, setLookup] = useState<PlaceLookup | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((l: PlaceLookup | null) => {
    setLookup(l);
    // Preselect what is new or different; a value equal to what is entered needs no tick.
    if (l?.status === 'done') setPicked(Object.fromEntries(l.findings.map((f) => [f.key, f.value !== f.current])));
  }, []);

  const poll = useCallback(
    (started = Date.now()) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        try {
          const { lookup: l } = await api.get<{ lookup: PlaceLookup | null }>(`/api/items/${item.id}/place-lookup`);
          show(l);
          if (l?.status === 'pending' && Date.now() - started < 4 * 60_000) poll(started);
        } catch (err) {
          setError(errorMessage(err));
        }
      }, 3000);
    },
    [item.id, show],
  );

  useEffect(() => {
    api
      .get<{ lookup: PlaceLookup | null }>(`/api/items/${item.id}/place-lookup`)
      .then(({ lookup: l }) => {
        show(l);
        if (l?.status === 'pending') poll();
      })
      .catch(() => {});
    return () => window.clearTimeout(timer.current);
  }, [item.id, poll, show]);

  const start = async () => {
    setError(null);
    try {
      const { lookup: l } = await api.post<{ lookup: PlaceLookup }>(`/api/items/${item.id}/place-lookup`);
      show(l);
      poll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const apply = async () => {
    if (!lookup) return;
    const chosen = lookup.findings.filter((f) => picked[f.key]);
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/items/${item.id}`, { details: { ...item.details, ...Object.fromEntries(chosen.map((f) => [f.key, f.value])) } });
      onApplied();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const label = LOOKUP_LABEL[item.type];
  if (!label) return null;
  const pending = lookup?.status === 'pending';
  const chosenCount = lookup?.findings.filter((f) => picked[f.key]).length ?? 0;

  return (
    <section className="place-lookup">
      <div className="place-lookup-head">
        <strong>Am Reisetag</strong>
        <button className="btn" onClick={start} disabled={pending}>
          {pending ? 'Sucht …' : lookup ? 'Erneut abfragen' : label}
        </button>
      </div>
      {!lookup && (
        <p className="muted small-print">
          Sucht auf Live-Seiten von Flughafen, Airline oder Bahn gezielt nach diesem Termin. Gate und Gleis stehen oft erst kurz vorher fest. Gespeichert wird erst mit „Übernehmen“.
        </p>
      )}
      {pending && <p className="muted small-print">Die Abfrage läuft, das dauert meist unter einer Minute.</p>}
      {lookup?.status === 'failed' && <ErrorBox error={lookup.error ?? 'Die Abfrage ist fehlgeschlagen.'} />}
      {lookup?.status === 'done' && (
        <>
          {lookup.findings.length > 0 ? (
            <ul className="place-findings">
              {lookup.findings.map((f) => (
                <li key={f.key}>
                  <label className="place-finding">
                    <input type="checkbox" checked={!!picked[f.key]} onChange={(e) => setPicked({ ...picked, [f.key]: e.target.checked })} />
                    <span>
                      <strong>{f.label} {f.value}</strong>
                      {f.current && f.current !== f.value && <span className="muted"> (bisher {f.current})</span>}
                      {f.current === f.value && <span className="muted"> (wie eingetragen)</span>}
                      <small className="muted">
                        {f.note ? `${f.note} · ` : ''}
                        <a href={f.source.url} target="_blank" rel="noreferrer">{f.source.title}</a>
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small-print">{lookup.summary || 'Nichts gefunden.'} Schau auf die Anzeigetafel oder in die App der Airline bzw. Bahn.</p>
          )}
          {lookup.findings.length > 0 && lookup.summary && <p className="muted small-print">{lookup.summary}</p>}
          <p className="muted small-print">
            Stand {lookup.finishedAt ? new Date(lookup.finishedAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '?'}
            {lookup.queries?.length ? ` · gesucht: ${lookup.queries.join(' · ')}` : ''}
          </p>
          {lookup.findings.length > 0 && (
            <button className="btn btn-primary" onClick={apply} disabled={busy || chosenCount === 0}>
              {busy ? 'Speichert…' : `Übernehmen (${chosenCount})`}
            </button>
          )}
        </>
      )}
      <ErrorBox error={error} />
    </section>
  );
}
