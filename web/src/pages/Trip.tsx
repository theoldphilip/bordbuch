import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AiImportDialog } from '../components/AiImportDialog.tsx';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../App.tsx';
import {
  ROLE_LABELS,
  addDays,
  dayKindInfo,
  endLabel,
  fmtDate,
  fmtDayHeader,
  fmtMoney,
  fmtRange,
  fmtSize,
  itemSubtitle,
  itemTypeInfo,
  tzLabel,
} from '../format.ts';
import type { Attachment, Cruise, CruiseDay, Item, ItemType, Role, Timeline, TimelineEntry, TimelinePhase, TripDetail, User } from '../types.ts';
import { Empty, ErrorBox, Field, Modal, Spinner } from '../components/ui.tsx';
import { ItemForm } from '../components/ItemForm.tsx';
import { DocReview } from '../components/DocReview.tsx';
import { CruiseDayForm, CruiseForm } from '../components/CruiseForms.tsx';

type Tab = 'timeline' | 'cruise' | 'docs' | 'share';

type Dialog =
  | { kind: 'item'; item?: Item; type?: ItemType; date?: string; cruiseDayId?: string }
  | { kind: 'cruise'; cruise?: Cruise }
  | { kind: 'day'; cruise: Cruise; day?: CruiseDay }
  | { kind: 'trip' }
  | { kind: 'review'; attachmentId: string }
  | null;

export function TripPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const consumedNav = useRef(false);

  useEffect(() => {
    api.get<{ enabled: boolean }>('/api/ai/status').then((s) => setAiEnabled(s.enabled)).catch(() => {});
  }, []);

  /** Reviews documents one after another; leaving the dialog keeps the rest in the inbox. */
  const openReview = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setQueue(ids);
    setQueueTotal(ids.length);
    setDialog({ kind: 'review', attachmentId: ids[0]! });
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([
        api.get<TripDetail>(`/api/trips/${tripId}`),
        api.get<Timeline>(`/api/trips/${tripId}/timeline`),
      ]);
      setDetail(d);
      setTimeline(t);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tripId]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  useEffect(() => {
    if (!detail || consumedNav.current) return;
    const state = location.state as { reviewQueue?: string[]; importErrors?: string } | null;
    if (!state) return;
    consumedNav.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (state.importErrors) setError(`Nicht gelesen:\n${state.importErrors}`);
    if (state.reviewQueue?.length) openReview(state.reviewQueue);
  }, [detail, location, navigate, openReview]);

  if (!detail || !timeline) return error ? <ErrorBox error={error} /> : <Spinner />;

  const canEdit = detail.role !== 'viewer';
  const allDates = timeline.phases.flatMap((p) => p.days.map((d) => d.date));
  const close = () => setDialog(null);
  const saved = () => {
    setDialog(null);
    setQueue([]);
    load();
  };
  const reviewDone = () => {
    const rest = queue.slice(1);
    load();
    if (rest.length) {
      setQueue(rest);
      setDialog({ kind: 'review', attachmentId: rest[0]! });
    } else {
      setQueue([]);
      setDialog(null);
    }
  };
  const clearPhase = async (ids: string[], title: string) => {
    if (!confirm(`Alle ${ids.length} Einträge im Abschnitt „${title}“ löschen?\n\nAngehängte Dokumente werden ebenfalls gelöscht. Mehrtägige Einträge (z. B. Parkplatz) verschwinden auch in anderen Abschnitten.`)) return;
    try {
      await api.post(`/api/trips/${detail.trip.id}/items/delete`, { ids });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const aiImport: ReactNode =
    canEdit && aiEnabled ? (
      <AiImportButton tripId={detail.trip.id} label="✨ Mit KI aus Dokumenten aufbauen" onReady={openReview} onError={setError} />
    ) : null;

  return (
    <div className="page">
      <div className="trip-hero" style={{ ['--trip-color' as string]: detail.trip.color ?? '#14385c' }}>
        <div>
          <h1>{detail.trip.title}</h1>
          <p>{fmtRange(detail.trip.startDate ?? allDates[0] ?? null, detail.trip.endDate ?? allDates.at(-1) ?? null)}</p>
        </div>
        {canEdit && <button className="btn btn-on-color" onClick={() => setDialog({ kind: 'trip' })}>Bearbeiten</button>}
      </div>

      <nav className="tabs" role="tablist">
        {(
          [
            ['timeline', 'Ablauf'],
            ['cruise', 'Kreuzfahrt'],
            ['docs', `Dokumente${detail.attachments.length ? ` (${detail.attachments.length})` : ''}${canEdit && detail.attachments.some((a) => a.analysisStatus === 'done') ? ' 📥' : ''}`],
            ['share', 'Teilen'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
      <ErrorBox error={error} />

      {tab === 'timeline' && (
        <TimelineView
          timeline={timeline}
          detail={detail}
          canEdit={canEdit}
          onOpenItem={(item) => setDialog({ kind: 'item', item })}
          onAdd={(date, cruiseDayId, type) => setDialog({ kind: 'item', date, cruiseDayId, type })}
          onAddCruise={() => setDialog({ kind: 'cruise' })}
          onReview={(id) => openReview([id])}
          onClear={clearPhase}
          aiImport={aiImport}
          onOpenDay={(day) => {
            const cruise = detail.cruises.find((c) => c.id === day.cruiseId);
            if (cruise && canEdit) setDialog({ kind: 'day', cruise, day });
          }}
        />
      )}
      {tab === 'cruise' && (
        <CruiseTab detail={detail} canEdit={canEdit} aiImport={aiImport} onEditCruise={(cruise) => setDialog({ kind: 'cruise', cruise })} onEditDay={(cruise, day) => setDialog({ kind: 'day', cruise, day })} />
      )}
      {tab === 'docs' && <DocsTab detail={detail} canEdit={canEdit} onChanged={load} onReview={(id) => openReview([id])} onReviewMany={openReview} />}
      {tab === 'share' && <ShareTab detail={detail} onChanged={load} />}

      {canEdit && tab === 'timeline' && (
        <button className="fab" onClick={() => setDialog({ kind: 'item' })} aria-label="Eintrag hinzufügen">+</button>
      )}

      {dialog?.kind === 'item' && (
        <ItemForm
          tripId={detail.trip.id}
          cruises={detail.cruises}
          item={dialog.item}
          initialType={dialog.type}
          initialDate={dialog.date}
          initialCruiseDayId={dialog.cruiseDayId}
          readOnly={!canEdit}
          onClose={close}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'cruise' && <CruiseForm tripId={detail.trip.id} cruise={dialog.cruise} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'day' && <CruiseDayForm cruise={dialog.cruise} day={dialog.day} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'trip' && <TripSettings detail={detail} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'review' && <DocReview key={dialog.attachmentId} attachmentId={dialog.attachmentId} tripId={detail.trip.id} cruises={detail.cruises} position={{ index: queueTotal - queue.length + 1, total: queueTotal }} onClose={saved} onApplied={reviewDone} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
function TimelineView({
  timeline,
  detail,
  canEdit,
  onOpenItem,
  onAdd,
  onAddCruise,
  onReview,
  onClear,
  aiImport,
  onOpenDay,
}: {
  timeline: Timeline;
  detail: TripDetail;
  canEdit: boolean;
  onOpenItem: (item: Item) => void;
  onAdd: (date?: string, cruiseDayId?: string, type?: ItemType) => void;
  onAddCruise: () => void;
  onReview: (attachmentId: string) => void;
  onClear: (ids: string[], title: string) => void;
  aiImport: ReactNode;
  onOpenDay: (day: CruiseDay) => void;
}) {
  const attachmentCount = (itemId: string) => detail.attachments.filter((a) => a.itemId === itemId).length;
  const warningsFor = (itemId: string, role: 'start' | 'end') =>
    timeline.warnings.filter((w) => w.itemId === itemId && (w.role ?? 'start') === role);
  const dayWarnings = (dayId: string) => timeline.warnings.filter((w) => w.cruiseDayId === dayId && !w.itemId);
  const cruisePhases = timeline.phases.filter((p) => p.kind === 'cruise');
  const suggestDate = (phase: TimelinePhase): string | undefined =>
    phase.kind === 'pre'
      ? cruisePhases[0]?.startDate ? addDays(cruisePhases[0].startDate, -1) : undefined
      : phase.kind === 'post'
        ? (cruisePhases.at(-1)?.endDate ?? undefined)
        : undefined;

  const pendingDocs = detail.attachments.filter((a) => a.analysisStatus === 'done');
  const banner =
    canEdit && pendingDocs.length > 0 ? (
      <button className="inbox-banner" onClick={() => onReview(pendingDocs[0]!.id)}>
        <span aria-hidden>📥</span>
        <span>
          <strong>{pendingDocs.length === 1 ? '1 Dokument wartet' : `${pendingDocs.length} Dokumente warten`} auf Zuordnung</strong>
          <br />
          <small>Die KI hat Vorschläge erstellt. Tippe zum Prüfen.</small>
        </span>
      </button>
    ) : null;

  if (timeline.phases.length === 0) {
    return (
      <>
      {banner}
      <Empty icon="🗺️" title="Noch nichts geplant">
        <p>Füge Flüge, Hotels und Transfers hinzu – oder lege direkt die Kreuzfahrt mit ihrer Route an.</p>
        {canEdit && (
          <div className="btn-row">
            {aiImport}
            <button className="btn btn-primary" onClick={onAddCruise}>🛳️ Kreuzfahrt anlegen</button>
            <button className="btn" onClick={() => onAdd()}>+ Eintrag</button>
          </div>
        )}
      </Empty>
      </>
    );
  }

  return (
    <div className="timeline">
      {banner}
      {timeline.warnings.length > 0 && <WarningList timeline={timeline} detail={detail} onOpenItem={onOpenItem} />}
      {detail.cruises.length === 0 && canEdit && (
        <button className="hint-card" onClick={onAddCruise}>
          🛳️ <span><strong>Kreuzfahrt hinzufügen</strong><br /><small>Dann wird dein Ablauf automatisch in Anreise, Kreuzfahrt und Abreise gegliedert.</small></span>
        </button>
      )}
      {timeline.phases.map((phase, i) => (
        <PhaseSection
          key={`${phase.kind}-${i}`}
          phase={phase}
          suggestDate={suggestDate(phase)}
          timeline={timeline}
          canEdit={canEdit}
          attachmentCount={attachmentCount}
          warningsFor={warningsFor}
          dayWarnings={dayWarnings}
          onOpenItem={onOpenItem}
          onAdd={onAdd}
          onClear={onClear}
          onOpenDay={onOpenDay}
        />
      ))}
    </div>
  );
}

function WarningList({ timeline, detail, onOpenItem }: { timeline: Timeline; detail: TripDetail; onOpenItem: (i: Item) => void }) {
  const [open, setOpen] = useState(true);
  const errors = timeline.warnings.filter((w) => w.level === 'error').length;
  const warns = timeline.warnings.filter((w) => w.level === 'warning').length;
  const infos = timeline.warnings.length - errors - warns;
  const summary = [errors && `${errors} kritisch`, warns && `${warns} knapp`, infos && `${infos} Hinweis${infos > 1 ? 'e' : ''}`].filter(Boolean).join(' · ');
  return (
    <section className={`checks ${errors ? 'has-error' : warns ? 'has-warning' : ''}`}>
      <button className="checks-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{errors ? '⛔' : warns ? '⚠️' : 'ℹ️'} Puffer-Check: {summary}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul>
          {timeline.warnings.map((w, i) => {
            const item = w.itemId ? detail.items.find((x) => x.id === w.itemId) : undefined;
            return (
              <li key={i} className={`check check-${w.level}`}>
                <span>{w.message}</span>
                {item && <button className="link" onClick={() => onOpenItem(item)}>öffnen</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const QUICK_ADD: ItemType[] = ['flight', 'train', 'transfer', 'hotel', 'parking', 'car_rental'];
const PHASE_ICONS: Record<TimelinePhase['kind'], string> = { trip: '🗺️', pre: '🛫', cruise: '🛳️', between: '🏨', post: '🛬' };

function PhaseSection({
  phase,
  suggestDate,
  timeline,
  canEdit,
  attachmentCount,
  warningsFor,
  dayWarnings,
  onOpenItem,
  onAdd,
  onClear,
  onOpenDay,
}: {
  phase: TimelinePhase;
  suggestDate?: string;
  timeline: Timeline;
  canEdit: boolean;
  attachmentCount: (id: string) => number;
  warningsFor: (id: string, role: 'start' | 'end') => Timeline['warnings'];
  dayWarnings: (id: string) => Timeline['warnings'];
  onOpenItem: (item: Item) => void;
  onAdd: (date?: string, cruiseDayId?: string, type?: ItemType) => void;
  onClear: (ids: string[], title: string) => void;
  onOpenDay: (day: CruiseDay) => void;
}) {
  const itemIds = [...new Set(phase.days.flatMap((d) => d.entries.map((e) => e.itemId)))];
  return (
    <section className={`phase phase-${phase.kind}`}>
      <header className="phase-head">
        <span className="phase-icon" aria-hidden>{PHASE_ICONS[phase.kind]}</span>
        <div>
          <h2>{phase.title}</h2>
          <p>{fmtRange(phase.startDate, phase.endDate)}{phase.kind === 'cruise' ? ` · ${phase.days.length} Tage` : ''}</p>
        </div>
        {canEdit && phase.kind !== 'cruise' && itemIds.length > 0 && (
          <button className="btn btn-ghost small clear-btn" onClick={() => onClear(itemIds, phase.title)} aria-label={`Abschnitt ${phase.title} leeren`}>Leeren</button>
        )}
      </header>
      {canEdit && (phase.kind === 'pre' || phase.kind === 'post') && (
        <div className="quick-add" aria-label={`${phase.title} planen`}>
          {QUICK_ADD.map((t) => (
            <button key={t} type="button" className="type-chip" onClick={() => onAdd(suggestDate, undefined, t)}>
              <span aria-hidden>{itemTypeInfo(t).icon}</span> {itemTypeInfo(t).label}
            </button>
          ))}
        </div>
      )}
      {phase.days.length === 0 && (
        <p className="muted phase-empty">
          {phase.kind === 'pre'
            ? 'Noch nichts geplant. Wie kommst du zum Schiff? Flug, Bahn, eigenes Auto mit Parkplatz, Übernachtung vor der Abfahrt, Transfer zum Hafen …'
            : 'Noch nichts geplant. Wie geht es nach der Ausschiffung weiter? Transfer, Übernachtung, Rückflug, Parkplatz abholen …'}
        </p>
      )}
      {phase.days.map((day) => {
        const cd = day.cruiseDay;
        return (
          <div className="day" key={`${day.date}-${cd?.id ?? ''}`}>
            <div className="day-head">
              <span className="day-date">{fmtDayHeader(day.date)}</span>
              {canEdit && (
                <button className="icon-btn small" onClick={() => onAdd(day.date, cd && cd.kind !== 'sea' ? cd.id : undefined, cd?.kind === 'port' ? 'excursion' : undefined)} aria-label="Eintrag an diesem Tag hinzufügen">+</button>
              )}
            </div>
            {cd && <PortCard day={cd} defaultTz={timeline.defaultTimezone} warnings={dayWarnings(cd.id)} onClick={() => onOpenDay(cd)} />}
            {day.entries.map((e) => (
              <EntryRow key={`${e.itemId}-${e.role}`} entry={e} defaultTz={timeline.defaultTimezone} attachments={e.role === 'start' ? attachmentCount(e.itemId) : 0} warnings={warningsFor(e.itemId, e.role)} onClick={() => onOpenItem(e.item)} />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function PortCard({ day, defaultTz, warnings, onClick }: { day: CruiseDay; defaultTz: string; warnings: Timeline['warnings']; onClick: () => void }) {
  const info = dayKindInfo(day.kind);
  const tz = day.timezone && tzLabel(day.timezone, day.date) !== tzLabel(defaultTz, day.date) ? tzLabel(day.timezone, day.date) : null;
  const times: [string, string | null][] =
    day.kind === 'embarkation'
      ? [['Check-in', day.arrival], ['Alle an Bord', day.allAboard], ['Abfahrt', day.departure]]
      : day.kind === 'disembarkation'
        ? [['Ankunft', day.arrival], ['Von Bord bis', day.departure]]
        : [['An', day.arrival], ['Ab', day.departure], ['Alle an Bord', day.allAboard]];
  return (
    <button className={`port-card kind-${day.kind}`} onClick={onClick}>
      <span className="port-icon" aria-hidden>{info.icon}</span>
      <span className="port-main">
        <strong>{day.kind === 'sea' ? 'Seetag' : (day.portName ?? info.label)}</strong>
        {day.kind !== 'sea' && (
          <small>
            {info.label}
            {day.country ? ` · ${day.country}` : ''}
            {day.tender ? ' · Tender' : ''}
            {tz ? ` · Ortszeit ${tz}` : ''}
          </small>
        )}
        {day.notes && <small className="muted">{day.notes}</small>}
        {(day.infos?.length ?? 0) > 0 && <small className="muted">{day.infos.some((i) => i.kind === 'emergency') ? '🆘' : '☎️'} {day.infos.length} Zusatzinfo{day.infos.length > 1 ? 's' : ''}</small>}
        {warnings.map((w, i) => <small key={i} className={`inline-warn ${w.level}`}>{w.message}</small>)}
      </span>
      {day.kind !== 'sea' && (
        <span className="port-times">
          {times.filter(([, v]) => v).map(([label, v]) => (
            <span key={label} className={label === 'Alle an Bord' ? 'all-aboard' : ''}>
              <small>{label}</small> {v}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function EntryRow({ entry, defaultTz, attachments, warnings, onClick }: { entry: TimelineEntry; defaultTz: string; attachments: number; warnings: Timeline['warnings']; onClick: () => void }) {
  const { item } = entry;
  const info = itemTypeInfo(item.type);
  const isEnd = entry.role === 'end';
  const endTime = !isEnd && item.endLocal && item.endLocal.slice(0, 10) === item.startLocal.slice(0, 10) && item.endLocal.length > 10 ? item.endLocal.slice(11, 16) : null;
  const arrivesOtherDay = !isEnd && item.endLocal && item.endLocal.slice(0, 10) !== item.startLocal.slice(0, 10) && !['hotel', 'car_rental', 'parking'].includes(item.type);
  const tz = tzLabel(entry.timezone, item.startLocal) !== tzLabel(defaultTz, item.startLocal) ? tzLabel(entry.timezone, item.startLocal) : null;
  const level = warnings.find((w) => w.level === 'error') ? 'error' : warnings.find((w) => w.level === 'warning') ? 'warning' : null;
  return (
    <button className={`entry type-${item.type}${isEnd ? ' is-end' : ''}${level ? ` has-${level}` : ''}`} onClick={onClick}>
      <span className="entry-time">
        {entry.time ?? '—'}
        {endTime && <small>– {endTime}</small>}
        {tz && entry.time && <small className="tz">{tz}</small>}
      </span>
      <span className="entry-icon" aria-hidden>{info.icon}</span>
      <span className="entry-main">
        <strong>{isEnd ? `${endLabel[item.type] ?? 'Ende'}: ${item.title}` : item.title}</strong>
        {!isEnd && <small>{itemSubtitle(item)}</small>}
        {arrivesOtherDay && <small>Ankunft {fmtDate(item.endLocal, { weekday: 'short', day: 'numeric', month: 'short' })} {item.endLocal!.slice(11, 16)}</small>}
        {warnings.filter((w) => w.level !== 'info').map((w, i) => <small key={i} className={`inline-warn ${w.level}`}>{w.message}</small>)}
      </span>
      <span className="entry-meta">
        {item.confirmation && !isEnd && <small className="code">{item.confirmation}</small>}
        {!isEnd && (item.infos?.length ?? 0) > 0 && <small title="Zusatzinfos">{item.infos.some((i) => i.kind === 'emergency') ? '🆘' : '☎️'} {item.infos.length}</small>}
        {attachments > 0 && <small>📎 {attachments}</small>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cruise tab
// ---------------------------------------------------------------------------
function CruiseTab({ detail, canEdit, aiImport, onEditCruise, onEditDay }: { detail: TripDetail; canEdit: boolean; aiImport: ReactNode; onEditCruise: (c?: Cruise) => void; onEditDay: (c: Cruise, d?: CruiseDay) => void }) {
  if (detail.cruises.length === 0) {
    return (
      <Empty icon="🛳️" title="Keine Kreuzfahrt">
        <p>Lege Schiff, Kabine und Route an. Hafentage mit „Alle an Bord“-Zeiten werden dann im Ablauf angezeigt und geprüft.</p>
        {canEdit && (
          <div className="btn-row">
            {aiImport}
            <button className="btn btn-primary" onClick={() => onEditCruise()}>Kreuzfahrt von Hand anlegen</button>
          </div>
        )}
      </Empty>
    );
  }
  const excursionCount = (dayId: string) => detail.items.filter((i) => i.cruiseDayId === dayId).length;
  return (
    <div className="stack">
      {detail.cruises.map((c) => (
        <section key={c.id} className="card">
          <header className="card-head">
            <div>
              <h2>🛳️ {c.shipName}</h2>
              <p className="muted">{[c.cruiseLine, c.cabin && `Kabine ${c.cabin}`, c.bookingRef && `Buchung ${c.bookingRef}`].filter(Boolean).join(' · ')}</p>
            </div>
            {canEdit && <button className="btn" onClick={() => onEditCruise(c)}>Bearbeiten</button>}
          </header>
          {c.notes && <p className="notes">{c.notes}</p>}
          <table className="route">
            <thead>
              <tr><th>Datum</th><th>Hafen</th><th>An</th><th>Ab</th><th>An Bord</th></tr>
            </thead>
            <tbody>
              {c.days.map((d) => (
                <tr key={d.id} onClick={() => canEdit && onEditDay(c, d)} className={canEdit ? 'clickable' : ''}>
                  <td>{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td>
                    <span aria-hidden>{dayKindInfo(d.kind).icon}</span> {d.kind === 'sea' ? <em>Seetag</em> : (d.portName ?? dayKindInfo(d.kind).label)}
                    {d.tender && <span className="badge small">Tender</span>}
                    {excursionCount(d.id) > 0 && <span className="badge small" title="Einträge an diesem Tag">📌 {excursionCount(d.id)}</span>}
                  </td>
                  <td>{d.arrival ?? ''}</td>
                  <td>{d.departure ?? ''}</td>
                  <td className="all-aboard">{d.allAboard ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && <button className="btn btn-ghost" onClick={() => onEditDay(c)}>+ Reisetag</button>}
        </section>
      ))}
      {canEdit && <button className="btn" onClick={() => onEditCruise()}>+ Weitere Kreuzfahrt (Back-to-Back)</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents tab
// ---------------------------------------------------------------------------
function DocsTab({ detail, canEdit, onChanged, onReview, onReviewMany }: { detail: TripDetail; canEdit: boolean; onChanged: () => void; onReview: (attachmentId: string) => void; onReviewMany: (ids: string[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ enabled: boolean; model: string | null } | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean; model: string | null }>('/api/ai/status').then(setAi).catch(() => setAi({ enabled: false, model: null }));
  }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const [n, file] of Array.from(files).entries()) {
        setProgress(`${n + 1} von ${files.length}: ${file.name}`);
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/api/trips/${detail.trip.id}/attachments${itemId ? `?itemId=${itemId}` : ''}`, fd);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
      onChanged();
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = (id: string, name: string) => api.openAttachment(id, name).catch((e) => setError(errorMessage(e)));
  const inbox = detail.attachments.filter((a) => a.analysisStatus === 'done' || a.analysisStatus === 'failed');
  const act = async (id: string, path: 'analyze' | 'dismiss') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/attachments/${id}/${path}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`„${name}“ löschen?`)) return;
    try {
      await api.del(`/api/attachments/${id}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const groups = new Map<string, typeof detail.attachments>();
  for (const a of detail.attachments) {
    const key = a.itemId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const titleOf = (id: string) => (id ? (detail.items.find((i) => i.id === id)?.title ?? 'Eintrag') : 'Allgemein');

  return (
    <div className="stack">
      {canEdit && (
        <section className="card upload">
          <Field label="Zuordnen zu">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Allgemein (ganze Reise)</option>
              {detail.items.map((i) => (
                <option key={i.id} value={i.id}>{itemTypeInfo(i.type).icon} {i.title} · {fmtDate(i.startLocal, { day: 'numeric', month: 'short' })}</option>
              ))}
            </select>
          </Field>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} accept="application/pdf,image/*,.pkpass,.eml,.txt,.html" />
          {ai?.enabled && <AiImportButton tripId={detail.trip.id} label="✨ Mit KI zuordnen" onReady={onReviewMany} onError={setError} />}
          <button className={`btn${ai?.enabled ? '' : ' btn-primary'}`} onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Lädt hoch…' : ai?.enabled ? '📎 Nur ablegen (ohne KI)' : '📎 Dateien hochladen'}
          </button>
          {progress && <p className="muted wide-line">Datei {progress}.</p>}
          {ai?.enabled && !progress && (
            <p className="privacy-note wide-line">
              <strong>Mit KI zuordnen</strong> liest Bestätigungen, Tickets, Screenshots und Text und legt die Einträge nach deiner Bestätigung an. Der Inhalt geht dabei an die Claude-API von Anthropic. <strong>Nur ablegen</strong> speichert die Dateien, ohne sie zu lesen.
            </p>
          )}
          {ai && !ai.enabled && <p className="privacy-note wide-line">Die automatische Zuordnung ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt auf dem Server).</p>}
        </section>
      )}
      {canEdit && inbox.length > 0 && (
        <section className="card inbox">
          <h3>📥 Zu prüfen</h3>
          <ul>
            {inbox.map((a) => (
              <li key={a.id}>
                <span className="file-name">{a.filename}</span>
                {a.analysisStatus === 'done' ? (
                  <button className="btn btn-primary small" onClick={() => onReview(a.id)}>Prüfen</button>
                ) : (
                  <>
                    <small className="error-text">{a.analysisError ?? 'Analyse fehlgeschlagen'}</small>
                    {ai?.enabled && <button className="btn small" disabled={busy} onClick={() => act(a.id, 'analyze')}>Erneut versuchen</button>}
                    <button className="btn btn-ghost small" disabled={busy} onClick={() => act(a.id, 'dismiss')}>Nur behalten</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ErrorBox error={error} />
      {detail.attachments.length === 0 && <Empty icon="📄" title="Keine Dokumente"><p>Bordkarten, Tickets, Hotelbestätigungen, Ausflugs-Vouchers – alles an einem Ort.</p></Empty>}
      {[...groups.entries()].map(([key, files]) => (
        <section key={key} className="card">
          <h3>{titleOf(key)}</h3>
          <ul className="file-list">
            {files.map((a) => (
              <li key={a.id}>
                <button className="file" onClick={() => open(a.id, a.filename)}>
                  <span aria-hidden>{a.mime.startsWith('image/') ? '🖼️' : a.mime === 'application/pdf' ? '📕' : '📄'}</span>
                  <span className="file-name">{a.filename}</span>
                  <small className="muted">{fmtSize(a.size)}</small>
                </button>
                {canEdit && <button className="icon-btn small" onClick={() => remove(a.id, a.filename)} aria-label={`${a.filename} löschen`}>🗑</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share tab
// ---------------------------------------------------------------------------
function ShareTab({ detail, onChanged }: { detail: TripDetail; onChanged: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [addId, setAddId] = useState('');
  const [addRole, setAddRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const isOwner = detail.role === 'owner';

  useEffect(() => {
    api.get<User[]>('/api/users').then(setUsers).catch(() => {});
  }, []);

  const candidates = users.filter((u) => !detail.members.some((m) => m.userId === u.id));
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const total = detail.items.reduce<Record<string, number>>((acc, i) => {
    if (i.cost != null) acc[i.currency ?? 'CHF'] = (acc[i.currency ?? 'CHF'] ?? 0) + i.cost;
    return acc;
  }, {});

  return (
    <div className="stack">
      <section className="card">
        <h3>Mitreisende</h3>
        <ul className="member-list">
          {detail.members.map((m) => (
            <li key={m.userId}>
              <span className="avatar small">{m.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="member-name">{m.displayName}{m.userId === user.id && <small className="muted"> (du)</small>}</span>
              {isOwner && m.userId !== user.id ? (
                <>
                  <select value={m.role} onChange={(e) => run(() => api.put(`/api/trips/${detail.trip.id}/members/${m.userId}`, { role: e.target.value }))}>
                    {Object.entries(ROLE_LABELS).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                  </select>
                  <button className="icon-btn small" onClick={() => run(() => api.del(`/api/trips/${detail.trip.id}/members/${m.userId}`))} aria-label="Entfernen">✕</button>
                </>
              ) : (
                <span className="badge">{ROLE_LABELS[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
        {isOwner && candidates.length > 0 && (
          <div className="inline-form">
            <select value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Familienmitglied wählen…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)}>
              <option value="editor">Bearbeiten</option>
              <option value="viewer">Nur ansehen</option>
            </select>
            <button className="btn btn-primary" disabled={!addId} onClick={() => run(async () => { await api.put(`/api/trips/${detail.trip.id}/members/${addId}`, { role: addRole }); setAddId(''); })}>Hinzufügen</button>
          </div>
        )}
        {isOwner && candidates.length === 0 && <p className="muted">Weitere Familienmitglieder legst du unter Einstellungen an.</p>}
        {!isOwner && (
          <button className="btn btn-danger-ghost" onClick={() => confirm('Diese Reise verlassen?') && run(async () => { await api.del(`/api/trips/${detail.trip.id}/members/${user.id}`); navigate('/'); })}>Reise verlassen</button>
        )}
        <ErrorBox error={error} />
      </section>
      {Object.keys(total).length > 0 && (
        <section className="card">
          <h3>Kosten (erfasst)</h3>
          <ul className="plain">{Object.entries(total).map(([cur, sum]) => <li key={cur}><strong>{fmtMoney(sum, cur)}</strong></li>)}</ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trip settings
// ---------------------------------------------------------------------------
function TripSettings({ detail, onClose, onSaved }: { detail: TripDetail; onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(detail.trip.title);
  const [notes, setNotes] = useState(detail.trip.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api.patch(`/api/trips/${detail.trip.id}`, { title, notes: notes || null });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const remove = async () => {
    if (!confirm(`Reise „${detail.trip.title}“ mit allen Einträgen und Dokumenten endgültig löschen?`)) return;
    try {
      await api.del(`/api/trips/${detail.trip.id}`);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal
      title="Reise bearbeiten"
      onClose={onClose}
      footer={
        <>
          {detail.role === 'owner' && <button className="btn btn-danger-ghost" onClick={remove}>Reise löschen</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="form">
        <Field label="Name" wide><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Notizen" wide><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** Opens the dialog for documents, screenshots and text, then hands the ids with proposals to the review queue. */
function AiImportButton({ tripId, label, onReady, onError }: { tripId: string; label: string; onReady: (ids: string[]) => void; onError: (message: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>{label}</button>
      {open && <AiImportDialog tripId={tripId} onClose={() => setOpen(false)} onReady={onReady} onNotice={onError} />}
    </>
  );
}
