import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { fmtDate, fmtMoney, itemSubtitle, itemTypeInfo, paymentLabel } from '../format.ts';
import type { AnalysisView, Cruise, CruiseData, CruiseDay, Item, ItemData, ItemProposal, PaymentStatus, TripKind } from '../types.ts';
import { CruiseDayForm } from './CruiseForms.tsx';
import { ItemForm } from './ItemForm.tsx';
import { ErrorBox, Modal, Spinner } from './ui.tsx';
import { InfoSummary } from './InfoEditor.tsx';
import { ResearchPanel } from './ResearchPanel.tsx';

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

/** "angezahlt EUR 500.00, Rest fällig 1. März 2027" as read from the document, or null. */
function paymentText(d: { paymentStatus?: PaymentStatus | null; paidAmount?: number | null; dueDate?: string | null; currency?: string | null }): string | null {
  if (!d.paymentStatus) return null;
  const head = d.paymentStatus === 'deposit' && d.paidAmount != null ? `angezahlt ${fmtMoney(d.paidAmount, d.currency ?? null)}` : paymentLabel(d.paymentStatus);
  return d.dueDate && d.paymentStatus !== 'paid' ? `${head}, ${d.paymentStatus === 'deposit' ? 'Rest ' : ''}fällig ${fmtDate(d.dueDate)}` : head;
}

const CONFIDENCE = { high: ['sicher', 'conf-high'], medium: ['prüfen', 'conf-medium'], low: ['unsicher', 'conf-low'] } as const;

export function DocReview({ attachmentId, tripId, tripKind, cruises, position, onClose, onApplied }: { attachmentId: string; tripId: string; tripKind?: TripKind; cruises: Cruise[]; /** Set while several documents are reviewed one after another. */ position?: { index: number; total: number }; onClose: () => void; onApplied: () => void }) {
  const [view, setView] = useState<AnalysisView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cruiseAction, setCruiseAction] = useState<'apply' | 'skip'>('apply');
  const [cruiseData, setCruiseData] = useState<CruiseData | null>(null);
  // Price of the cruise as typed (kept as text so "1250," is not lost while typing).
  const [cruiseCost, setCruiseCost] = useState('');
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canResearch, setCanResearch] = useState(false);

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
      setCruiseData(v.cruise?.data ?? null);
      setCruiseCost(v.cruise?.data.cost != null ? String(v.cruise.data.cost) : '');
      setEditingDay(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [attachmentId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api.get<{ research?: boolean }>('/api/ai/status').then((s) => setCanResearch(!!s.research)).catch(() => {});
  }, []);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.action !== 'skip').length + (view?.cruise && cruiseAction === 'apply' ? 1 : 0);

  const apply = async () => {
    if (!view) return;
    const costText = cruiseCost.trim().replace(/['\s]/g, '').replace(',', '.');
    const cost = costText ? Number(costText) : null;
    if (cost !== null && !Number.isFinite(cost)) return setError('Preis der Kreuzfahrt: bitte eine Zahl eingeben, z. B. 3480,50.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/attachments/${attachmentId}/apply`, {
        items: rows.map((r) => ({ action: r.action, itemId: r.action === 'update' ? r.proposal.match?.itemId : undefined, data: r.data })),
        cruise: view.cruise && cruiseData ? { action: cruiseAction === 'skip' ? 'skip' : view.cruise.match ? 'update' : 'create', cruiseId: view.cruise.match?.cruiseId, data: { ...cruiseData, cost, currency: cost !== null ? cruiseData.currency || null : null } } : null,
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

  if (editingDay !== null && cruiseData?.days[editingDay]) {
    const draftCruise: Cruise = { id: '', tripId, shipName: cruiseData.shipName, cruiseLine: null, cabin: null, bookingRef: null, notes: null, infos: [], cost: null, currency: null, paymentStatus: null, paidAmount: null, dueDate: null, days: cruiseData.days.map((d) => ({ ...d, id: '', cruiseId: '' }) as CruiseDay) };
    return (
      <CruiseDayForm
        cruise={draftCruise}
        day={draftCruise.days[editingDay]}
        onClose={() => setEditingDay(null)}
        onSaved={() => {}}
        onSubmit={(payload) => {
          setCruiseData({ ...cruiseData, days: cruiseData.days.map((d, n) => (n === editingDay ? (payload as unknown as CruiseData['days'][number]) : d)).sort((a, b) => a.date.localeCompare(b.date)) });
          setCruiseAction('apply');
          setEditingDay(null);
        }}
      />
    );
  }

  if (editing !== null && rows[editing]) {
    const row = rows[editing]!;
    return (
      <ItemForm
        tripId={tripId}
        tripKind={tripKind}
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
      title={position && position.total > 1 ? `Dokument ${position.index} von ${position.total} prüfen` : 'Dokument prüfen'}
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
            <p className="muted">📎 {view.files.length > 1 ? `${view.files.length} Dateien zusammen: ${view.files.map((f) => f.filename).join(', ')}` : view.attachment.filename}</p>
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

          {canResearch && <ResearchPanel canRoute={tripKind === undefined || tripKind === 'cruise' || cruises.length > 0} key={`${view.analyzedAt}-${view.research?.suggestions.filter((x) => x.accepted).length ?? 0}`} view={view} attachmentId={attachmentId} hasEdits={rows.some((r) => r.edited) || (!!view.cruise && cruiseData !== view.cruise.data)} onAccepted={load} />}

          {view.cruise && cruiseData && (
            <section className={`proposal${cruiseAction === 'skip' ? ' skipped' : ''}`}>
              <header>
                <strong>🛳️ Kreuzfahrt</strong>
                <span className="muted">{cruiseData.days.length} Tage</span>
              </header>
              <div className="form cruise-edit">
                <label className="field wide"><span className="field-label">Schiff</span><input value={cruiseData.shipName} onChange={(e) => setCruiseData({ ...cruiseData, shipName: e.target.value })} /></label>
                <label className="field"><span className="field-label">Kabine</span><input value={cruiseData.cabin ?? ''} onChange={(e) => setCruiseData({ ...cruiseData, cabin: e.target.value || null })} /></label>
                <label className="field"><span className="field-label">Buchungsnummer</span><input value={cruiseData.bookingRef ?? ''} onChange={(e) => setCruiseData({ ...cruiseData, bookingRef: e.target.value || null })} /></label>
                <label className="field"><span className="field-label">Preis</span><input inputMode="decimal" value={cruiseCost} onChange={(e) => setCruiseCost(e.target.value)} /></label>
                <label className="field"><span className="field-label">Währung</span><input value={cruiseData.currency ?? ''} maxLength={3} onChange={(e) => setCruiseData({ ...cruiseData, currency: e.target.value.toUpperCase() || null })} /></label>
              </div>
              {cruiseCost.trim() && paymentText(cruiseData) && <p className="muted">Zahlung laut Dokument: {paymentText(cruiseData)}</p>}
              <InfoSummary infos={cruiseData.infos ?? []} />
              <p className="muted small-print">Tippe auf einen Tag, um ihn zu korrigieren, oder entferne ihn mit ✕.{cruiseData.days.some((d) => d.infos?.length) ? ' Zusatzinfos zu den Tagen siehst du im Tag.' : ''}</p>
              {cruiseData.days.length > 0 && cruiseData.days.every((d) => d.kind === 'embarkation' || d.kind === 'disembarkation') && (
                <p className="match-note">Aus dem Dokument sind nur Beginn und Ende der Kreuzfahrt bekannt. Die Tage dazwischen ergänzt „Reiseverlauf recherchieren“ oder du legst sie später selbst an.</p>
              )}
              <ul className="route-preview">
                {cruiseData.days.map((d, i) => (
                  <li key={i}>
                    <button className="route-day" onClick={() => setEditingDay(i)}>
                      <span>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</span>
                      <span>{d.kind === 'sea' ? 'Seetag' : `${d.kind === 'embarkation' ? 'Einschiffung · ' : d.kind === 'disembarkation' ? 'Ausschiffung · ' : ''}${[d.portName, d.country].filter(Boolean).join(', ') || (d.kind === 'port' ? 'Hafen' : '')}`}</span>
                      <span className="muted">{[d.arrival, d.departure].filter(Boolean).join(' – ')}</span>
                    </button>
                    <button className="icon-btn small" aria-label="Tag entfernen" onClick={() => setCruiseData({ ...cruiseData, days: cruiseData.days.filter((_, n) => n !== i) })}>✕</button>
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
                  {[r.data.confirmation && `Buchung ${r.data.confirmation}`, r.data.cost != null && fmtMoney(r.data.cost, r.data.currency), paymentText(r.data)].filter(Boolean).join(' · ')}
                </p>
                {r.data.cruiseDayId && <p className="muted">⚓ Einem Hafentag zugeordnet</p>}
                {r.data.notes && <p className="muted notes-preview">📝 {r.data.notes}</p>}
                <InfoSummary infos={r.data.infos ?? []} />
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
