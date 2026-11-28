import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import type { Cruise, CruiseDay, Item, ReviewFinding, TripDetail, TripReview } from '../types.ts';
import { ErrorBox, Modal, Spinner } from './ui.tsx';

const SEVERITY = {
  error: { icon: '⛔', label: 'Fehler', cls: 'check-error' },
  warning: { icon: '⚠️', label: 'Warnung', cls: 'check-warning' },
  hint: { icon: '💡', label: 'Hinweis', cls: '' },
} as const;

interface State {
  review: TripReview | null;
  stale: boolean;
}

/**
 * AI review of the whole trip. Read-only: it lists gaps and contradictions and links to the entries
 * concerned, the user decides what to change.
 */
export function TripReviewDialog({ detail, canEdit, onClose, onOpenItem, onOpenDay }: {
  detail: TripDetail;
  canEdit: boolean;
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onOpenDay: (cruise: Cruise, day: CruiseDay) => void;
}) {
  const tripId = detail.trip.id;
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.get<State>(`/api/trips/${tripId}/review`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tripId]);
  useEffect(() => {
    load();
  }, [load]);

  // Poll while it runs; it takes up to a minute.
  const pending = state?.review?.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.post<State>(`/api/trips/${tripId}/review`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const itemOf = (id: string) => detail.items.find((i) => i.id === id);
  const dayOf = (id: string): [Cruise, CruiseDay] | null => {
    for (const c of detail.cruises) {
      const d = c.days.find((x) => x.id === id);
      if (d) return [c, d];
    }
    return null;
  };

  const review = state?.review ?? null;
  const counts = review?.status === 'done' ? (['error', 'warning', 'hint'] as const).map((s) => review.findings.filter((f) => f.severity === s).length) : [];

  const renderFinding = (f: ReviewFinding, n: number) => {
    const sev = SEVERITY[f.severity];
    return (
      <li key={n} className={`review-finding check-item ${sev.cls}`}>
        <div className="review-finding-body">
          <strong>{sev.icon} {f.title}</strong>
          <p>{f.text}</p>
          {f.suggestion && <p className="muted">➜ {f.suggestion}</p>}
          <div className="review-links">
            {f.itemIds.map((id) => {
              const item = itemOf(id);
              return item ? <button key={id} className="btn small" onClick={() => onOpenItem(item)}>{item.title}</button> : null;
            })}
            {f.dayIds.map((id) => {
              const hit = dayOf(id);
              return hit && canEdit ? <button key={id} className="btn small" onClick={() => onOpenDay(hit[0], hit[1])}>Tag {hit[1].date.slice(8, 10)}.{hit[1].date.slice(5, 7)}.</button> : null;
            })}
          </div>
        </div>
      </li>
    );
  };

  return (
    <Modal
      title="Reise prüfen"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          {canEdit && review && review.status !== 'pending' && <button className="btn" onClick={start} disabled={busy}>Neu prüfen</button>}
          <button className="btn btn-primary" onClick={onClose}>Schließen</button>
        </>
      }
    >
      <div className="stack">
        {!state && !error && (
          <div className="center-block"><Spinner /></div>
        )}

        {state && !review && (
          <>
            <p className="muted">
              Die KI sieht sich die ganze Reise an und sucht nach Lücken und Widersprüchen, zum Beispiel fehlende Rückreise, kein Transfer zum Hafen, Hotelnächte, die nicht passen, oder Einträge außerhalb der Reise. Sie ändert nichts, du bekommst nur eine Liste.
            </p>
            <p className="privacy-note">Dafür gehen Titel, Zeiten und Orte der Einträge an den eingestellten KI-Anbieter. Buchungsnummern, Preise, Telefonnummern und die Dokumente selbst werden nicht gesendet.</p>
            {canEdit ? <button className="btn btn-primary" onClick={start} disabled={busy}>🔍 Reise jetzt prüfen</button> : <p className="muted">Nur Bearbeiter können die Prüfung starten.</p>}
          </>
        )}

        {pending && <p className="muted" role="status">⏳ Die KI prüft die Reise… das dauert bis zu einer Minute. Du kannst das Fenster offen lassen.</p>}

        {review?.status === 'failed' && (
          <>
            <p className="error-text">{review.error ?? 'Die Prüfung ist fehlgeschlagen.'}</p>
            {canEdit && <button className="btn" onClick={start} disabled={busy}>Erneut versuchen</button>}
          </>
        )}

        {review?.status === 'done' && (
          <>
            {state?.stale && <p className="match-note">Die Reise wurde seit dieser Prüfung geändert. Mit „Neu prüfen“ bekommst du den aktuellen Stand.</p>}
            {review.summary && <p>{review.summary}</p>}
            <p className="small-print muted">
              {review.findings.length === 0 ? 'Keine Auffälligkeiten.' : `${counts[0]} Fehler · ${counts[1]} ${counts[1] === 1 ? 'Warnung' : 'Warnungen'} · ${counts[2]} ${counts[2] === 1 ? 'Hinweis' : 'Hinweise'}`}
              {review.finishedAt && ` · Stand ${new Date(review.finishedAt).toLocaleString('de-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            </p>
            {review.findings.length > 0 && <ul className="review-list">{review.findings.map(renderFinding)}</ul>}
            <p className="small-print muted">KI-Einschätzung auf Basis der erfassten Daten. Bitte selbst gegenprüfen, bevor du etwas änderst{review.model ? ` (${review.model})` : ''}.</p>
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
