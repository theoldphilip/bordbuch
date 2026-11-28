import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { failedText, runImport, type ImportInput } from '../aiImport.ts';
import { KindPicker } from '../components/KindPicker.tsx';
import { InputCollector } from '../components/InputCollector.tsx';
import { api, errorMessage } from '../api.ts';
import { daysUntil, fmtRange, todayIso, tripKindInfo } from '../format.ts';
import type { TripDetail, TripSummary, TripKind } from '../types.ts';
import { Empty, ErrorBox, Field, Modal, Spinner } from '../components/ui.tsx';

const COLORS = ['#14385c', '#1f7a8c', '#2e8b57', '#c0603a', '#8e44ad', '#b8860b'];

function Countdown({ trip }: { trip: TripSummary }) {
  const start = daysUntil(trip.effectiveStartDate);
  const end = daysUntil(trip.effectiveEndDate);
  if (start === null) return null;
  if (start > 1) return <span className="badge">in {start} Tagen</span>;
  if (start === 1) return <span className="badge badge-accent">morgen</span>;
  if (end !== null && end >= 0) return <span className="badge badge-accent">unterwegs</span>;
  return null;
}

function TripCard({ trip }: { trip: TripSummary }) {
  return (
    <Link to={`/trips/${trip.id}`} className="trip-card" style={{ ['--trip-color' as string]: trip.color ?? '#14385c' }}>
      <div className="trip-card-stripe" />
      <div className="trip-card-body">
        <div className="trip-card-top">
          <h3>{trip.title}</h3>
          <Countdown trip={trip} />
        </div>
        <p className="muted">{fmtRange(trip.effectiveStartDate, trip.effectiveEndDate)}</p>
        <p className="trip-card-meta">
          {trip.ships.length > 0 ? <span>🛳️ {trip.ships.join(', ')}</span> : <span>{tripKindInfo(trip.kind).icon} {tripKindInfo(trip.kind).label}</span>}
          {trip.memberCount > 1 && <span>👥 {trip.memberCount}</span>}
          {trip.role === 'viewer' && <span>👁 nur ansehen</span>}
        </p>
      </div>
    </Link>
  );
}

export function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get<TripSummary[]>('/api/trips').then(setTrips).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!trips) return error ? <ErrorBox error={error} /> : <Spinner />;

  const today = todayIso();
  const upcoming = trips.filter((t) => !t.effectiveEndDate || t.effectiveEndDate >= today);
  const past = trips.filter((t) => t.effectiveEndDate && t.effectiveEndDate < today).reverse();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Meine Reisen</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Neue Reise</button>
      </div>
      <ErrorBox error={error} />
      {trips.length === 0 && (
        <Empty icon="🧭" title="Noch keine Reisen">
          <p>Lege deine erste Reise an – mit An- und Abreise, Übernachtung, Parkplatz und Kreuzfahrt.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>Reise anlegen</button>
        </Empty>
      )}
      {upcoming.length > 0 && (
        <section className="trip-grid">{upcoming.map((t) => <TripCard key={t.id} trip={t} />)}</section>
      )}
      {past.length > 0 && (
        <>
          <h2 className="section-title">Vergangene Reisen</h2>
          <section className="trip-grid past">{past.map((t) => <TripCard key={t.id} trip={t} />)}</section>
        </>
      )}
      {creating && <NewTripModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewTripModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('manual');
  const [inputs, setInputs] = useState<ImportInput[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TripKind | 'auto'>('cruise');
  const [color, setColor] = useState(COLORS[0]!);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>('/api/ai/status')
      .then((s) => {
        setAiEnabled(s.enabled);
        if (s.enabled) {
          setMode('ai');
          setKind('auto');
        }
      })
      .catch(() => setAiEnabled(false));
  }, []);

  const save = async () => {
    const useAi = mode === 'ai';
    if (!useAi && !title.trim()) return setError('Bitte einen Namen eingeben.');
    if (useAi && inputs.length === 0) return setError('Bitte mindestens ein Dokument, einen Screenshot oder Text hinzufügen, oder wechsle zu „Von Hand“.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TripDetail>('/api/trips', { title: title.trim() || 'Neue Reise', color, kind: kind === 'auto' ? 'city' : kind });
      const id = res.trip.id;
      if (!useAi) return navigate(`/trips/${id}`);
      const imported = await runImport(id, inputs, grouped, setProgress);
      if (!title.trim() && imported.titleSuggestion) await api.patch(`/api/trips/${id}`, { title: imported.titleSuggestion }).catch(() => {});
      navigate(`/trips/${id}`, { state: { reviewQueue: imported.ready, importErrors: failedText(imported.failed) } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Neue Reise"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? (mode === 'ai' ? 'Analysiert…' : 'Legt an…') : mode === 'ai' ? `Mit KI aufbauen${inputs.length ? ` (${inputs.length})` : ''}` : 'Anlegen'}
          </button>
        </>
      }
    >
      <div className="form">
        {aiEnabled && (
          <div className="segmented wide" role="tablist">
            <button role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')} disabled={busy}>✨ Mit KI aus Dokumenten</button>
            <button role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')} disabled={busy}>Von Hand</button>
          </div>
        )}

        {mode === 'ai' && (
          <div className="ai-start wide">
            <p>
              Lade die <strong>Buchungen</strong> oder den Reiseplan hoch (Kreuzfahrt, Flüge, Hotels, Mietwagen, Parkplatz, Transfers, Programm einer Rundreise). Dateien, Fotos, eingefügte Screenshots und Text sind möglich. Die KI baut daraus die Reise auf. Du prüfst alles, bevor etwas gespeichert wird, und kannst danach jederzeit selbst ändern, ergänzen oder löschen.
            </p>
            <InputCollector inputs={inputs} setInputs={setInputs} grouped={grouped} setGrouped={setGrouped} disabled={busy} />
            <p className="privacy-note">Die Dokumente werden zur Analyse an den eingestellten KI-Anbieter gesendet.</p>
          </div>
        )}

        <Field label="Art der Reise" wide hint={kind === 'auto' ? 'Die App erkennt aus den Dokumenten, ob es eine Kreuzfahrt, ein Städtetrip oder eine Rundreise ist. Du kannst es danach ändern.' : undefined}>
          <KindPicker value={kind} onChange={setKind} disabled={busy} extra={mode === 'ai' ? { value: 'auto', label: 'Automatisch erkennen', icon: '✨', hint: 'Nach den hochgeladenen Dokumenten' } : undefined} />
        </Field>
        <Field label={mode === 'ai' ? 'Name der Reise (optional, sonst schlägt ihn die KI vor)' : 'Name der Reise'} wide>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mittelmeer Mai 2027" autoFocus={mode === 'manual'} disabled={busy} onKeyDown={(e) => e.key === 'Enter' && mode === 'manual' && save()} />
        </Field>
        <Field label="Farbe" wide>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`color-dot${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} />
            ))}
          </div>
        </Field>
        {progress && <p className="muted wide">{progress}. Das kann pro Dokument bis zu einer Minute dauern.</p>}
        {mode === 'manual' && <p className="muted wide">Die Reisedaten ergeben sich automatisch aus Flügen, Hotels, Stationen und der Kreuzfahrt.</p>}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
