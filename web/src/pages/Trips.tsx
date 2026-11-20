import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { failedText, importDocuments } from '../aiImport.ts';
import { api, errorMessage } from '../api.ts';
import { daysUntil, fmtRange, todayIso } from '../format.ts';
import type { TripDetail, TripSummary } from '../types.ts';
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
          {trip.ships.length > 0 && <span>🛳️ {trip.ships.join(', ')}</span>}
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('manual');
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState(COLORS[0]!);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>('/api/ai/status')
      .then((s) => {
        setAiEnabled(s.enabled);
        if (s.enabled) setMode('ai');
      })
      .catch(() => setAiEnabled(false));
  }, []);

  const save = async () => {
    const useAi = mode === 'ai';
    if (!useAi && !title.trim()) return setError('Bitte einen Namen eingeben.');
    if (useAi && files.length === 0) return setError('Bitte mindestens ein Dokument auswählen, oder wechsle zu „Von Hand“.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TripDetail>('/api/trips', { title: title.trim() || 'Neue Reise', color });
      const id = res.trip.id;
      if (!useAi) return navigate(`/trips/${id}`);
      const imported = await importDocuments(id, files, setProgress);
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
            {busy ? (mode === 'ai' ? 'Analysiert…' : 'Legt an…') : mode === 'ai' ? 'Mit KI aufbauen' : 'Anlegen'}
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
              Lade die <strong>Kreuzfahrt-Buchung</strong> oder den Reiseplan hoch, dazu gern Flug-, Hotel-, Parkplatz- und Transfer-Bestätigungen. Die KI baut daraus die Reise auf. Du prüfst alles, bevor etwas gespeichert wird, und kannst danach jederzeit selbst ändern, ergänzen oder löschen.
            </p>
            <input ref={fileRef} type="file" multiple hidden accept="application/pdf,image/*,.eml,.txt,.html" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>📎 {files.length ? `${files.length} Dokument${files.length > 1 ? 'e' : ''} gewählt – ändern` : 'Dokumente auswählen'}</button>
            {files.length > 0 && <ul className="plain">{files.map((f, i) => <li key={i} className="muted">{f.name}</li>)}</ul>}
            <p className="privacy-note">Die Dokumente werden zur Analyse an die Claude-API von Anthropic gesendet.</p>
          </div>
        )}

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
        {mode === 'manual' && <p className="muted wide">Die Reisedaten ergeben sich automatisch aus Flügen, Hotels und der Kreuzfahrt.</p>}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
