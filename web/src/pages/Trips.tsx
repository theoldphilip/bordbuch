import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const [title, setTitle] = useState('');
  const [color, setColor] = useState(COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return setError('Bitte einen Namen eingeben.');
    setBusy(true);
    try {
      const res = await api.post<TripDetail>('/api/trips', { title, color });
      navigate(`/trips/${res.trip.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Neue Reise"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>Anlegen</button>
        </>
      }
    >
      <div className="form">
        <Field label="Name der Reise" wide>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mittelmeer Mai 2027" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="Farbe" wide>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`color-dot${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} />
            ))}
          </div>
        </Field>
        <p className="muted wide">Die Reisedaten ergeben sich automatisch aus Flügen, Hotels und der Kreuzfahrt.</p>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
