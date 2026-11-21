import { useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { DAY_KINDS, addDays } from '../format.ts';
import type { Cruise, CruiseDay, CruiseDayKind } from '../types.ts';
import { ErrorBox, Field, Modal, TimezoneInput } from './ui.tsx';
import { InfoEditor } from './InfoEditor.tsx';

export function CruiseForm({ tripId, cruise, onClose, onSaved }: { tripId: string; cruise?: Cruise; onClose: () => void; onSaved: () => void }) {
  const [shipName, setShipName] = useState(cruise?.shipName ?? '');
  const [cruiseLine, setCruiseLine] = useState(cruise?.cruiseLine ?? '');
  const [cabin, setCabin] = useState(cruise?.cabin ?? '');
  const [bookingRef, setBookingRef] = useState(cruise?.bookingRef ?? '');
  const [notes, setNotes] = useState(cruise?.notes ?? '');
  const [infos, setInfos] = useState(cruise?.infos ?? []);
  // Route generator (new cruises only)
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fromPort, setFromPort] = useState('');
  const [toPort, setToPort] = useState('');
  const [fromTz, setFromTz] = useState('');
  const [toTz, setToTz] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nights = fromDate && toDate ? Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) : 0;

  const save = async () => {
    setError(null);
    if (!shipName.trim()) return setError('Bitte den Schiffsnamen angeben.');
    const base = { shipName, cruiseLine: cruiseLine || null, cabin: cabin || null, bookingRef: bookingRef || null, notes: notes || null, infos: infos.filter((i) => i.label.trim() && i.value.trim()) };
    setBusy(true);
    try {
      if (cruise) {
        await api.patch(`/api/cruises/${cruise.id}`, base);
      } else {
        const days: Partial<CruiseDay>[] = [];
        if (fromDate && toDate) {
          if (nights < 1 || nights > 120) throw new Error('Das Enddatum muss nach dem Startdatum liegen (max. 120 Nächte).');
          days.push({ date: fromDate, kind: 'embarkation', portName: fromPort || null, timezone: fromTz || null });
          for (let i = 1; i < nights; i++) days.push({ date: addDays(fromDate, i), kind: 'sea' });
          days.push({ date: toDate, kind: 'disembarkation', portName: toPort || null, timezone: toTz || fromTz || null });
        }
        await api.post(`/api/trips/${tripId}/cruises`, { ...base, days });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!cruise || !confirm(`Kreuzfahrt „${cruise.shipName}“ mit allen Reisetagen löschen? Einträge bleiben erhalten.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/cruises/${cruise.id}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={cruise ? 'Kreuzfahrt bearbeiten' : 'Kreuzfahrt hinzufügen'}
      onClose={onClose}
      footer={
        <>
          {cruise && <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>Löschen</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
        </>
      }
    >
      <div className="form">
        <Field label="Schiff" wide><input value={shipName} onChange={(e) => setShipName(e.target.value)} placeholder="z. B. Mein Schiff 4" autoFocus={!cruise} /></Field>
        <Field label="Reederei"><input value={cruiseLine} onChange={(e) => setCruiseLine(e.target.value)} /></Field>
        <Field label="Kabine"><input value={cabin} onChange={(e) => setCabin(e.target.value)} placeholder="8142, Balkon" /></Field>
        <Field label="Buchungsnummer" wide><input value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} /></Field>
        {!cruise && (
          <>
            <h3 className="form-section wide">Route anlegen <small>(optional – Häfen kannst du danach pro Tag ergänzen)</small></h3>
            <Field label="Einschiffung am"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
            <Field label="Hafen"><input value={fromPort} onChange={(e) => setFromPort(e.target.value)} placeholder="Civitavecchia" /></Field>
            <Field label="Ausschiffung am"><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} /></Field>
            <Field label="Hafen"><input value={toPort} onChange={(e) => setToPort(e.target.value)} placeholder="Barcelona" /></Field>
            <Field label="Zeitzone Start"><TimezoneInput value={fromTz} onChange={setFromTz} placeholder="Europe/Rome" /></Field>
            <Field label="Zeitzone Ende"><TimezoneInput value={toTz} onChange={setToTz} placeholder={fromTz || 'Europe/Madrid'} /></Field>
            {nights > 0 && <p className="muted wide">{nights} Nächte · es werden {nights + 1} Tage angelegt (Zwischentage zunächst als Seetage).</p>}
          </>
        )}
        <div className="wide">
          <h3 className="form-section">Zusatzinfos <small>z. B. Notfallnummer der Reederei, Hotline</small></h3>
          <InfoEditor infos={infos} onChange={setInfos} />
        </div>
        <Field label="Notizen" wide><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

export function CruiseDayForm({ cruise, day, readOnly, onUnlock, onSubmit, onClose, onSaved }: { cruise: Cruise; day?: CruiseDay; /** Show the day without letting anyone change it (view mode, viewers). */ readOnly?: boolean; onUnlock?: () => void; /** When set, the payload is handed back instead of saved (editing an AI proposal). */ onSubmit?: (payload: Record<string, unknown>) => void | Promise<void>; onClose: () => void; onSaved: () => void }) {
  const lastDay = cruise.days.at(-1);
  const [date, setDate] = useState(day?.date ?? (lastDay ? addDays(lastDay.date, 1) : ''));
  const [kind, setKind] = useState<CruiseDayKind>(day?.kind ?? 'port');
  const [portName, setPortName] = useState(day?.portName ?? '');
  const [country, setCountry] = useState(day?.country ?? '');
  const [timezone, setTimezone] = useState(day?.timezone ?? '');
  const [arrival, setArrival] = useState(day?.arrival ?? '');
  const [departure, setDeparture] = useState(day?.departure ?? '');
  const [allAboard, setAllAboard] = useState(day?.allAboard ?? '');
  const [tender, setTender] = useState(day?.tender ?? false);
  const [notes, setNotes] = useState(day?.notes ?? '');
  const [infos, setInfos] = useState(day?.infos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSea = kind === 'sea';
  const labels: Record<CruiseDayKind, [string, string, string]> = {
    embarkation: ['Check-in ab', 'Abfahrt', 'Alle an Bord'],
    port: ['Ankunft', 'Abfahrt', 'Alle an Bord'],
    sea: ['', '', ''],
    disembarkation: ['Ankunft', 'Von Bord bis', ''],
  };
  const [lArr, lDep, lAll] = labels[kind];
  // Prefill a sensible "all aboard" from departure (30 min before) if empty.
  const suggestAllAboard = () => {
    if (allAboard || !departure) return;
    const [h, m] = departure.split(':').map(Number) as [number, number];
    const t = (h * 60 + m - 30 + 1440) % 1440;
    setAllAboard(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  };

  const save = async () => {
    setError(null);
    const payload = {
      date,
      kind,
      portName: isSea ? null : portName || null,
      country: isSea ? null : country || null,
      timezone: timezone || null,
      arrival: isSea ? null : arrival || null,
      departure: isSea ? null : departure || null,
      allAboard: isSea || kind === 'disembarkation' ? null : allAboard || null,
      tender: !isSea && tender,
      notes: notes || null,
      infos: infos.filter((i) => i.label.trim() && i.value.trim()),
    };
    setBusy(true);
    try {
      if (onSubmit) {
        await onSubmit(payload);
        return;
      }
      if (day) await api.patch(`/api/cruise-days/${day.id}`, payload);
      else await api.post(`/api/cruises/${cruise.id}/days`, payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!day || !confirm('Diesen Reisetag löschen?')) return;
    setBusy(true);
    try {
      await api.del(`/api/cruise-days/${day.id}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={onSubmit ? 'Reisetag prüfen' : day ? (readOnly ? (day.portName ?? 'Reisetag') : 'Reisetag bearbeiten') : 'Reisetag hinzufügen'}
      onClose={onClose}
      footer={
        readOnly ? (
          <>
            {onUnlock && <button className="btn" onClick={onUnlock}>🔒 Ändern …</button>}
            <span className="spacer" />
            <button className="btn btn-primary" onClick={onClose}>Schließen</button>
          </>
        ) : (
        <>
          {day && !onSubmit && <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>Löschen</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichert…' : onSubmit ? 'Übernehmen' : 'Speichern'}</button>
        </>
        )
      }
    >
      <fieldset disabled={readOnly} className="form">
        <div className="type-picker wide" role="radiogroup" aria-label="Art des Tages">
          {DAY_KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className={`type-chip${kind === k.kind ? ' active' : ''}`} onClick={() => setKind(k.kind)}>
              <span aria-hidden>{k.icon}</span> {k.label}
            </button>
          ))}
        </div>
        <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Zeitzone" hint="Ortszeit des Hafens"><TimezoneInput value={timezone} onChange={setTimezone} placeholder="Standard" /></Field>
        {!isSea && (
          <>
            <Field label="Hafen"><input value={portName} onChange={(e) => setPortName(e.target.value)} placeholder="Neapel" /></Field>
            <Field label="Land"><input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Italien" /></Field>
            <Field label={lArr}><input type="time" value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
            <Field label={lDep} hint={kind === 'disembarkation' ? 'Nur das Limit oder dein Slot, wenn die Abreise über die Reederei läuft. Bei eigener Abreise rechnet die App ab 06:00 (oder 30 Min. nach Ankunft des Schiffs).' : undefined}><input type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} onBlur={suggestAllAboard} /></Field>
            {lAll && <Field label={lAll} hint="Steht im Tagesprogramm an Bord"><input type="time" value={allAboard} onChange={(e) => setAllAboard(e.target.value)} /></Field>}
            {kind !== 'disembarkation' && (
              <label className="check">
                <input type="checkbox" checked={tender} onChange={(e) => setTender(e.target.checked)} />
                Tenderhafen (Ausbooten)
              </label>
            )}
          </>
        )}
        <div className="wide">
          <h3 className="form-section">Zusatzinfos <small>z. B. Notrufnummer, Agentur vor Ort</small></h3>
          <InfoEditor infos={infos} onChange={setInfos} />
        </div>
        <Field label="Notizen" wide><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isSea ? 'z. B. Kapitänsdinner' : ''} /></Field>
      </fieldset>
      <ErrorBox error={error} />
    </Modal>
  );
}
