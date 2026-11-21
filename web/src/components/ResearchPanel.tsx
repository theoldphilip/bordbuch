import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { fmtDate } from '../format.ts';
import type { AnalysisView, Research, ResearchDiagnostics, ResearchSuggestion } from '../types.ts';
import { InfoSummary } from './InfoEditor.tsx';

const FIELD_LABELS: Record<string, string> = {
  location: 'Ort / Adresse', startTz: 'Zeitzone Beginn', endTz: 'Zeitzone Ende', endLocal: 'Ende', provider: 'Anbieter',
  country: 'Land', timezone: 'Zeitzone', arrival: 'Ankunft', departure: 'Abfahrt', allAboard: 'Alle an Bord',
};

function targetLabel(view: AnalysisView, s: ResearchSuggestion): string {
  const { kind, index } = s.target;
  if (kind === 'item') return view.items[index]?.data.title ?? 'Eintrag';
  if (kind === 'day') {
    const d = view.cruise?.data.days[index];
    return d ? `Hafentag ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}. ${[d.portName, d.country].filter(Boolean).join(', ')}`.trim() : 'Tag';
  }
  return `Kreuzfahrt ${view.cruise?.data.shipName ?? s.route?.shipName ?? ''}`.trim();
}

const KIND_LABEL = { embarkation: 'Einschiffung', port: 'Hafen', sea: 'Seetag', disembarkation: 'Ausschiffung' } as const;

/** What was searched and why results were dropped: makes "nothing found" understandable. */
function Diagnostics({ d, open }: { d: ResearchDiagnostics; open?: boolean }) {
  return (
    <details className="research-diag" open={open}>
      <summary>Was wurde gesucht?</summary>
      <ul className="plain">
        <li><span className="muted">Suchanfragen:</span> {d.queries.length ? d.queries.map((q, n) => <span key={n}>{n > 0 && ' · '}„{q}“</span>) : 'keine'}</li>
        {d.fetched.length > 0 && <li><span className="muted">Gelesene Seiten:</span> {d.fetched.join(', ')}</li>}
        <li><span className="muted">Gefundene Quellen:</span> {d.sourcesFound}{d.droppedNoSource > 0 && ` · ${d.droppedNoSource} Fund ohne prüfbare Quelle verworfen`}{d.droppedInvalid > 0 && ` · ${d.droppedInvalid} unbrauchbar`}</li>
      </ul>
      {d.notes && <p className="small-print muted research-notes">{d.notes}</p>}
    </details>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * Optional web research for gaps in the analysis. Results are shown here first; only the ones the user
 * ticks and accepts flow into the proposals below, and nothing is stored before "Übernehmen".
 */
export function ResearchPanel({ view, attachmentId, hasEdits, onAccepted }: { view: AnalysisView; attachmentId: string; hasEdits: boolean; onAccepted: () => void }) {
  const [research, setResearch] = useState<Research | null>(view.research);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  const open = research?.suggestions.filter((s) => !s.accepted) ?? [];

  // Poll while the research runs; it takes a minute or two.
  useEffect(() => {
    if (research?.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const r = (await api.get<{ research: Research | null }>(`/api/attachments/${attachmentId}/research`)).research;
        if (r && r.status !== 'pending') {
          setResearch(r);
          setPicked(new Set(r.suggestions.map((s) => s.id)));
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [research?.status, attachmentId]);

  const start = async (mode: 'gaps' | 'route') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ research: Research }>(`/api/attachments/${attachmentId}/research`, { mode, url: url.trim() || null });
      setResearch(r.research);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (hasEdits && !window.confirm('Deine Änderungen an den Vorschlägen unten gehen dabei verloren, weil die Vorschläge neu aufgebaut werden. Fortfahren?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/attachments/${attachmentId}/research/accept`, { ids: [...picked] });
      onAccepted();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api.post(`/api/attachments/${attachmentId}/research/dismiss`);
      setResearch(null);
      setPicked(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <section className="proposal research">
      <header>
        <strong>🔎 Recherche im Internet</strong>
        <span className="muted">optional</span>
      </header>

      {!research && (
        <>
          <p className="muted">
            Die KI sucht im Internet nach dem, was fehlt. Du siehst die Funde mit Quelle zuerst hier und entscheidest, was übernommen wird.
          </p>
          <label className="field">
            <span className="field-label">Link zur Reise (optional)</span>
            <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… Seite der Reederei oder des Anbieters mit der Route" />
          </label>
          <p className="small-print muted">Mit Link liest die KI genau diese Seite. Das ist zuverlässiger als freies Suchen.</p>
          <div className="proposal-actions">
            <button className="btn btn-primary small" onClick={() => start('route')} disabled={busy}>🧭 Reiseverlauf recherchieren</button>
            <button className="btn small" onClick={() => start('gaps')} disabled={busy}>Lücken recherchieren</button>
          </div>
          <p className="privacy-note">Dafür gehen Schiff, Orte und Reisedaten aus der Analyse (und dein Link) an die Websuche von Anthropic. Das Dokument selbst wird nicht erneut gesendet.</p>
        </>
      )}

      {research?.status === 'pending' && (
        <p className="muted" role="status">⏳ {research.mode === 'route' ? 'Sucht den Reiseverlauf' : 'Recherchiert'}… das dauert ein bis zwei Minuten. Du kannst das Fenster offen lassen oder den Rest schon prüfen.</p>
      )}

      {research?.status === 'failed' && (
        <>
          <p className="error-text">{research.error ?? 'Die Recherche ist fehlgeschlagen.'}</p>
          {research.diagnostics && <Diagnostics d={research.diagnostics} />}
          <div className="proposal-actions">
            <button className="btn small" onClick={() => start(research.mode ?? 'gaps')} disabled={busy}>Erneut versuchen</button>
            <button className="btn btn-ghost small" onClick={discard} disabled={busy}>Schließen</button>
          </div>
        </>
      )}

      {research?.status === 'done' && (
        <>
          {research.summary && <p>{research.summary}</p>}
          {open.length === 0 && <p className="muted">{research.suggestions.length ? 'Alle Funde sind übernommen.' : 'Es wurden keine verwertbaren Ergänzungen gefunden. Mit einem Link zur Reise klappt es oft besser.'}</p>}
          {research.diagnostics && <Diagnostics d={research.diagnostics} open={research.suggestions.length === 0} />}
          {research.suggestions.length === 0 && (
            <div className="proposal-actions">
              <button className="btn small" onClick={discard} disabled={busy}>Mit Link erneut versuchen</button>
            </div>
          )}
          <ul className="research-list">
            {open.map((s) => (
              <li key={s.id}>
                <label className="research-pick">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span>
                    <strong>{s.title}</strong>
                    <small className="muted"> · {targetLabel(view, s)}</small>
                  </span>
                </label>
                {s.note && <p>{s.note}</p>}
                {s.route && (
                  <ul className="route-preview">
                    {s.route.days.map((d, n) => (
                      <li key={n}>
                        <span className="route-day static">
                          <span>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</span>
                          <span>{d.kind === 'sea' ? 'Seetag' : `${d.kind === 'embarkation' || d.kind === 'disembarkation' ? `${KIND_LABEL[d.kind]} · ` : ''}${[d.portName, d.country].filter(Boolean).join(', ') || (d.kind === 'port' ? 'Hafen' : '')}`}</span>
                          <span className="muted">{[d.arrival, d.departure].filter(Boolean).join(' – ')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.fields.length > 0 && <ul className="plain">{s.fields.map((f, n) => <li key={n}><span className="muted">{FIELD_LABELS[f.field] ?? f.field}:</span> {f.value}</li>)}</ul>}
                {s.details.length > 0 && <ul className="plain">{s.details.map((d, n) => <li key={n}><span className="muted">{d.key}:</span> {d.value}</li>)}</ul>}
                <InfoSummary infos={s.infos} />
                <p className="small-print muted">
                  Quelle:{' '}
                  {s.sources.map((x, n) => (
                    <span key={x.url}>
                      {n > 0 && ', '}
                      <a href={x.url} target="_blank" rel="noreferrer noopener">{host(x.url)}</a>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <p className="small-print muted">Aus dem Internet, nicht aus deinen Unterlagen. Zeiten und Nummern bitte kurz gegen die Quelle prüfen.</p>
          <div className="proposal-actions">
            {open.length > 0 && <button className="btn btn-primary small" onClick={accept} disabled={busy || picked.size === 0}>Ausgewählte übernehmen ({picked.size})</button>}
            <button className="btn btn-ghost small" onClick={discard} disabled={busy}>{open.length > 0 ? 'Verwerfen' : 'Schließen'}</button>
          </div>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
