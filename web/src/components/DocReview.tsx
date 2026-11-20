import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { fmtDate, fmtMoney, itemSubtitle, itemTypeInfo } from '../format.ts';
import type { AnalysisView, Cruise, Item, ItemData, ItemProposal } from '../types.ts';
import { ItemForm } from './ItemForm.tsx';
import { ErrorBox, Modal, Spinner } from './ui.tsx';

type Action = 'create' | 'update' | 'skip';
interface Row {
  proposal: ItemProposal;
  action: Action;
  data: ItemData;
  edited: boolean;
}

const asItem = (d: ItemData): Item => ({ ...d, id: '', tripId: '', createdAt: '', updatedAt: '' }) as Item;

function when(d: ItemData): string {
  const day = (l: string) => (/^\d{4}-\d{2}-\d{2}/.test(l) ? fmtDate(l, { weekday: 'short', day: 'numeric', month: 'short' }) : l);
  const time = (l: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(l) ? ` ${l.slice(11, 16)}` : '');
  const start = `${day(d.startLocal)}${time(d.startLocal)}`;
  if (!d.endLocal) return start;
  const sameDay = d.endLocal.slice(0, 10) === d.startLocal.slice(0, 10);
  return `${start} → ${sameDay ? time(d.endLocal).trim() || '' : `${day(d.endLocal)}${time(d.endLocal)}`}`;
}

const CONFIDENCE = { high: ['sicher', 'conf-high'], medium: ['prüfen', 'conf-medium'], low: ['unsicher', 'conf-low'] } as const;

export function DocReview({ attachmentId, tripId, cruises, onClose, onApplied }: { attachmentId: string; tripId: string; cruises: Cruise[]; onClose: () => void; onApplied: () => void }) {
  const [view, setView] = useState<AnalysisView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cruiseAction, setCruiseAction] = useState<'apply' | 'skip'>('apply');
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await api.get<AnalysisView>(`/api/attachments/${attachmentId}/analysis`);
      setView(v);
      setRows(
        v.items.map((p) => ({
          proposal: p,
          action: p.problems.length ? 'skip' : p.match ? 'update' : 'create',
          data: p.data,
          edited: false,
        })),
      );
      setCruiseAction(v.cruise && !v.cruise.problems.length ? 'apply' : 'skip');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [attachmentId]);
  useEffect(() => {
    load();
  }, [load]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.action !== 'skip').length + (view?.cruise && cruiseAction === 'apply' ? 1 : 0);

  const apply = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/attachments/${attachmentId}/apply`, {
        items: rows.map((r) => ({ action: r.action, itemId: r.action === 'update' ? r.proposal.match?.itemId : undefined, data: r.data })),
        cruise: view.cruise ? { action: cruiseAction === 'skip' ? 'skip' : view.cruise.match ? 'update' : 'create', cruiseId: view.cruise.match?.cruiseId, data: view.cruise.data } : null,
      });
      onApplied();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const keepOnly = async () => {
    setBusy(true);
    try {
      await api.post(`/api/attachments/${attachmentId}/dismiss`);
      onApplied();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const reanalyze = async () => {
    setBusy(true);
    setError(null);
    setView(null);
    try {
      await api.post(`/api/attachments/${attachmentId}/analyze`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing !== null && rows[editing]) {
    const row = rows[editing]!;
    return (
      <ItemForm
        tripId={tripId}
        cruises={cruises}
        item={asItem(row.data)}
        onClose={() => setEditing(null)}
        onSaved={() => {}}
        onSubmit={(payload) => {
          setRow(editing, { data: payload as unknown as ItemData, edited: true, action: row.action === 'skip' ? (row.proposal.match ? 'update' : 'create') : row.action });
          setEditing(null);
        }}
      />
    );
  }

  return (
    <Modal
      title="Dokument prüfen"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={keepOnly} disabled={busy || !view}>Nur Dokument behalten</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={apply} disabled={busy || !view || selected === 0}>
            {busy ? 'Übernimmt…' : `Übernehmen (${selected})`}
          </button>
        </>
      }
    >
      {!view && !error && (
        <div className="center-block">
          <Spinner />
          <p className="muted center">Lädt…</p>
        </div>
      )}
      {view && (
        <div className="stack">
          <div className="review-summary">
            <p className="muted">📎 {view.attachment.filename}</p>
            <p>
              <strong>{view.documentKind}</strong>
              {view.summary && <> – {view.summary}</>}
            </p>
          </div>
          {view.warnings.length > 0 && (
            <ul className="review-warnings">
              {view.warnings.map((w, i) => <li key={i}>⚠️ {w}</li>)}
            </ul>
          )}

          {view.cruise && (
            <section className={`proposal${cruiseAction === 'skip' ? ' skipped' : ''}`}>
              <header>
                <strong>🛳️ Kreuzfahrt {view.cruise.data.shipName}</strong>
                <span className="muted">{view.cruise.data.days.length} Tage</span>
              </header>
              <p className="muted">{[view.cruise.data.cruiseLine, view.cruise.data.cabin && `Kabine ${view.cruise.data.cabin}`, view.cruise.data.bookingRef && `Buchung ${view.cruise.data.bookingRef}`].filter(Boolean).join(' · ')}</p>
              <ul className="route-preview">
                {view.cruise.data.days.map((d, i) => (
                  <li key={i}>
                    <span>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</span>
                    <span>{d.kind === 'sea' ? 'Seetag' : [d.portName, d.country].filter(Boolean).join(', ') || d.kind}</span>
                    <span className="muted">{[d.arrival, d.departure].filter(Boolean).join(' – ')}</span>
                  </li>
                ))}
              </ul>
              {view.cruise.match ? (
                <p className="match-note">Gehört zur vorhandenen Kreuzfahrt „{view.cruise.match.shipName}“ ({view.cruise.match.reason}): {view.cruise.updatedDays} Tage werden ergänzt, {view.cruise.newDays} kommen neu dazu.</p>
              ) : (
                <p className="match-note">Wird als neue Kreuzfahrt angelegt.</p>
              )}
              {view.cruise.problems.length > 0 && <ul className="problems">{view.cruise.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              <div className="segmented">
                <button className={cruiseAction === 'apply' ? 'active' : ''} onClick={() => setCruiseAction('apply')} disabled={view.cruise.problems.length > 0}>{view.cruise.match ? 'Zusammenführen' : 'Anlegen'}</button>
                <button className={cruiseAction === 'skip' ? 'active' : ''} onClick={() => setCruiseAction('skip')}>Überspringen</button>
              </div>
            </section>
          )}

          {rows.map((r, i) => {
            const info = itemTypeInfo(r.data.type);
            const [confLabel, confClass] = CONFIDENCE[r.proposal.confidence];
            const sub = itemSubtitle(asItem(r.data));
            const problems = r.edited ? [] : r.proposal.problems;
            return (
              <section key={i} className={`proposal${r.action === 'skip' ? ' skipped' : ''}`}>
                <header>
                  <strong><span aria-hidden>{info.icon}</span> {r.data.title}</strong>
                  <span className={`conf ${confClass}`}>{confLabel}</span>
                </header>
                <p>{when(r.data)}</p>
                {sub && <p className="muted">{sub}</p>}
                <p className="muted">
                  {[r.data.confirmation && `Buchung ${r.data.confirmation}`, r.data.cost != null && fmtMoney(r.data.cost, r.data.currency)].filter(Boolean).join(' · ')}
                </p>
                {r.data.cruiseDayId && <p className="muted">⚓ Einem Hafentag zugeordnet</p>}
                {r.proposal.match ? (
                  <div className="match-note">
                    Gehört zu „{r.proposal.match.title}“ ({r.proposal.match.reason}).
                    {r.proposal.match.changes.length > 0 ? (
                      <ul>{r.proposal.match.changes.map((c, n) => <li key={n}>{c}</li>)}</ul>
                    ) : (
                      <> Keine neuen Angaben, das Dokument wird nur angehängt.</>
                    )}
                  </div>
                ) : (
                  <p className="match-note">Neuer Eintrag.</p>
                )}
                {problems.length > 0 && (
                  <ul className="problems">{problems.map((p, n) => <li key={n}>{p}</li>)}<li>Bitte über „Bearbeiten“ korrigieren.</li></ul>
                )}
                <div className="proposal-actions">
                  <div className="segmented">
                    <button className={r.action === 'create' ? 'active' : ''} onClick={() => setRow(i, { action: 'create' })} disabled={problems.length > 0}>Neu anlegen</button>
                    {r.proposal.match && <button className={r.action === 'update' ? 'active' : ''} onClick={() => setRow(i, { action: 'update' })} disabled={problems.length > 0}>Aktualisieren</button>}
                    <button className={r.action === 'skip' ? 'active' : ''} onClick={() => setRow(i, { action: 'skip' })}>Überspringen</button>
                  </div>
                  <button className="btn small" onClick={() => setEditing(i)}>Bearbeiten</button>
                </div>
              </section>
            );
          })}

          {rows.length === 0 && !view.cruise && (
            <div className="empty">
              <h3>Keine Reisedaten erkannt</h3>
              <p>Das Dokument wird trotzdem gespeichert. Du kannst die Einträge von Hand anlegen.</p>
            </div>
          )}
          <p className="muted small-print">Analysiert mit {view.model}. Bitte Zeiten und Nummern kurz gegen das Dokument prüfen.</p>
          <button className="btn btn-ghost" onClick={reanalyze} disabled={busy}>Neu analysieren</button>
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
