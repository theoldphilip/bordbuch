import { useMemo, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { DAY_KINDS, ITEM_TYPES, endLabel, fmtDayHeader, startLabel } from '../format.ts';
import type { Cruise, Item, ItemType } from '../types.ts';
import { ErrorBox, Field, Modal, TimezoneInput } from './ui.tsx';

type DetailField = { key: string; label: string; placeholder?: string };
const DETAIL_FIELDS: Partial<Record<ItemType, DetailField[]>> = {
  flight: [
    { key: 'airline', label: 'Airline', placeholder: 'SWISS' },
    { key: 'flightNumber', label: 'Flugnummer', placeholder: 'LX 1726' },
    { key: 'from', label: 'Von', placeholder: 'ZRH' },
    { key: 'to', label: 'Nach', placeholder: 'FCO' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'seat', label: 'Sitzplatz' },
  ],
  train: [
    { key: 'trainNumber', label: 'Zugnummer', placeholder: 'EC 15' },
    { key: 'from', label: 'Von' },
    { key: 'to', label: 'Nach' },
    { key: 'seat', label: 'Wagen / Platz' },
  ],
  bus: [{ key: 'from', label: 'Von' }, { key: 'to', label: 'Nach' }],
  ferry: [{ key: 'from', label: 'Von' }, { key: 'to', label: 'Nach' }, { key: 'cabin', label: 'Kabine/Deck' }],
  transfer: [{ key: 'mode', label: 'Art', placeholder: 'Taxi, Shuttle, Bahn…' }, { key: 'from', label: 'Von', placeholder: 'Flughafen FCO' }, { key: 'to', label: 'Nach', placeholder: 'Hafen Civitavecchia' }, { key: 'phone', label: 'Telefon Fahrer' }],
  car_rental: [{ key: 'carClass', label: 'Fahrzeug' }, { key: 'returnLocation', label: 'Rückgabeort' }],
  hotel: [{ key: 'room', label: 'Zimmer' }, { key: 'phone', label: 'Telefon' }, { key: 'breakfast', label: 'Verpflegung', placeholder: 'Frühstück inkl.' }],
  parking: [{ key: 'lot', label: 'Parkplatz / Parkhaus', placeholder: 'P3' }, { key: 'plate', label: 'Kennzeichen' }, { key: 'shuttle', label: 'Shuttle zum Terminal', placeholder: 'alle 15 min' }],
  excursion: [{ key: 'meetingPoint', label: 'Treffpunkt', placeholder: 'Theater, Deck 5' }],
  restaurant: [{ key: 'guests', label: 'Personen' }],
};

const LINKABLE: ItemType[] = ['excursion', 'activity', 'restaurant', 'note', 'transfer'];
const HAS_END: ItemType[] = ['flight', 'train', 'bus', 'ferry', 'transfer', 'car_rental', 'parking', 'hotel', 'excursion', 'activity', 'restaurant'];

const split = (local: string | null) => ({ date: local?.slice(0, 10) ?? '', time: local && local.length > 10 ? local.slice(11, 16) : '' });
const join = (date: string, time: string) => (date ? (time ? `${date}T${time}` : date) : null);

interface Props {
  tripId: string;
  cruises: Cruise[];
  item?: Item;
  initialType?: ItemType;
  initialDate?: string;
  initialCruiseDayId?: string;
  readOnly?: boolean;
  /** When set, the form hands the payload back instead of saving it (used to edit AI proposals). */
  onSubmit?: (payload: Record<string, unknown>) => void | Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}

export function ItemForm({ tripId, cruises, item, initialType, initialDate, initialCruiseDayId, readOnly, onSubmit, onClose, onSaved }: Props) {
  const [type, setType] = useState<ItemType>(item?.type ?? initialType ?? 'flight');
  const [title, setTitle] = useState(item?.title ?? '');
  const s = split(item?.startLocal ?? initialDate ?? null);
  const e = split(item?.endLocal ?? null);
  const [startDate, setStartDate] = useState(s.date);
  const [startTime, setStartTime] = useState(s.time);
  const [startTz, setStartTz] = useState(item?.startTz ?? '');
  const [endDate, setEndDate] = useState(e.date);
  const [endTime, setEndTime] = useState(e.time);
  const [endTz, setEndTz] = useState(item?.endTz ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [provider, setProvider] = useState(item?.provider ?? '');
  const [confirmation, setConfirmation] = useState(item?.confirmation ?? '');
  const [cost, setCost] = useState(item?.cost != null ? String(item.cost) : '');
  const [currency, setCurrency] = useState(item?.currency ?? 'CHF');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [cruiseDayId, setCruiseDayId] = useState(item?.cruiseDayId ?? initialCruiseDayId ?? '');
  const [details, setDetails] = useState<Record<string, string | undefined>>(item?.details ?? (type === 'excursion' ? { bookedVia: 'ship' } : {}));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allDays = useMemo(() => cruises.flatMap((c) => c.days.map((d) => ({ ...d, ship: c.shipName }))), [cruises]);
  const linkedDay = allDays.find((d) => d.id === cruiseDayId);
  const canLink = allDays.length > 0 && LINKABLE.includes(type);
  const isTransport = ['flight', 'train', 'bus', 'ferry', 'transfer'].includes(type);
  const showEnd = HAS_END.includes(type);

  const pickDay = (id: string) => {
    setCruiseDayId(id);
    const day = allDays.find((d) => d.id === id);
    if (day) {
      setStartDate(day.date);
      if (!endDate || endDate < day.date) setEndDate(day.date);
    }
  };

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError('Bitte einen Titel eingeben.');
    if (!startDate) return setError('Bitte ein Datum angeben.');
    const payload = {
      type,
      title: title.trim(),
      startLocal: join(startDate, startTime),
      startTz: startTz || null,
      endLocal: showEnd ? join(endDate || (endTime ? startDate : ''), endTime) : null,
      endTz: showEnd && isTransport ? endTz || null : null,
      location: location || null,
      provider: provider || null,
      confirmation: confirmation || null,
      cost: cost ? Number(cost.replace(',', '.')) : null,
      currency: cost ? currency || null : null,
      notes: notes || null,
      cruiseDayId: canLink && cruiseDayId ? cruiseDayId : null,
      details: Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
    };
    setBusy(true);
    try {
      if (onSubmit) {
        await onSubmit(payload);
        return;
      }
      if (item) await api.patch(`/api/items/${item.id}`, payload);
      else await api.post(`/api/trips/${tripId}/items`, payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item || !confirm(`„${item.title}“ wirklich löschen?`)) return;
    setBusy(true);
    try {
      await api.del(`/api/items/${item.id}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const tzPlaceholder = linkedDay?.timezone ?? 'Standard';

  return (
    <Modal
      title={onSubmit ? 'Vorschlag bearbeiten' : item ? (readOnly ? item.title : 'Eintrag bearbeiten') : 'Neuer Eintrag'}
      onClose={onClose}
      footer={
        readOnly ? (
          <button className="btn" onClick={onClose}>Schließen</button>
        ) : (
          <>
            {item && !onSubmit && <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>Löschen</button>}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Abbrechen</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly} className="form">
        {!item && (
          <div className="type-picker wide" role="radiogroup" aria-label="Art">
            {ITEM_TYPES.map((t) => (
              <button key={t.type} type="button" role="radio" aria-checked={type === t.type} className={`type-chip${type === t.type ? ' active' : ''}`} onClick={() => setType(t.type)}>
                <span aria-hidden>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        )}
        <Field label="Titel" wide>
          <input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder={type === 'flight' ? 'Zürich → Rom' : type === 'hotel' ? 'Hotel Artemide' : type === 'parking' ? 'Parkhaus Flughafen' : type === 'transfer' ? 'Taxi zum Hafen' : ''} autoFocus={!item} />
        </Field>

        {canLink && (
          <Field label="Kreuzfahrt-Tag" wide hint={type === 'excursion' ? 'Damit wird die „Alle an Bord“-Zeit geprüft.' : undefined}>
            <select value={cruiseDayId} onChange={(ev) => pickDay(ev.target.value)}>
              <option value="">— kein Kreuzfahrt-Tag —</option>
              {allDays.map((d) => (
                <option key={d.id} value={d.id}>
                  {fmtDayHeader(d.date)} · {DAY_KINDS.find((k) => k.kind === d.kind)!.label}
                  {d.portName ? ` · ${d.portName}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={`${startLabel[type] ?? 'Beginn'} – Datum`}>
          <input type="date" value={startDate} onChange={(ev) => setStartDate(ev.target.value)} />
        </Field>
        <Field label="Uhrzeit">
          <input type="time" value={startTime} onChange={(ev) => setStartTime(ev.target.value)} />
        </Field>
        {showEnd && (
          <>
            <Field label={`${endLabel[type] ?? 'Ende'} – Datum`}>
              <input type="date" value={endDate} onChange={(ev) => setEndDate(ev.target.value)} placeholder={startDate} />
            </Field>
            <Field label="Uhrzeit">
              <input type="time" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} />
            </Field>
          </>
        )}
        <Field label={isTransport ? 'Zeitzone Abflug/Abfahrt' : 'Zeitzone'} hint="Leer = Zeitzone des Hafens bzw. Standard">
          <TimezoneInput value={startTz} onChange={setStartTz} placeholder={tzPlaceholder} />
        </Field>
        {showEnd && isTransport && (
          <Field label="Zeitzone Ankunft">
            <TimezoneInput value={endTz} onChange={setEndTz} placeholder={startTz || tzPlaceholder} />
          </Field>
        )}

        {type === 'excursion' && (
          <Field label="Gebucht über" wide>
            <div className="segmented">
              {[
                ['ship', 'Reederei'],
                ['private', 'Privat'],
              ].map(([v, l]) => (
                <button key={v} type="button" className={details.bookedVia === v ? 'active' : ''} onClick={() => setDetails({ ...details, bookedVia: v })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
        )}

        {(DETAIL_FIELDS[type] ?? []).map((f) => (
          <Field key={f.key} label={f.label}>
            <input value={details[f.key] ?? ''} placeholder={f.placeholder} onChange={(ev) => setDetails({ ...details, [f.key]: ev.target.value })} />
          </Field>
        ))}

        {type !== 'note' && (
          <>
            <Field label={type === 'hotel' ? 'Adresse' : 'Ort'} wide>
              <input value={location} onChange={(ev) => setLocation(ev.target.value)} />
            </Field>
            <Field label="Anbieter">
              <input value={provider} onChange={(ev) => setProvider(ev.target.value)} placeholder={type === 'excursion' ? 'z. B. GetYourGuide' : ''} />
            </Field>
            <Field label="Buchungsnummer">
              <input value={confirmation} onChange={(ev) => setConfirmation(ev.target.value)} />
            </Field>
            <Field label="Kosten">
              <input inputMode="decimal" value={cost} onChange={(ev) => setCost(ev.target.value)} />
            </Field>
            <Field label="Währung">
              <input value={currency} maxLength={3} onChange={(ev) => setCurrency(ev.target.value.toUpperCase())} />
            </Field>
          </>
        )}
        <Field label="Notizen" wide>
          <textarea rows={3} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
        </Field>
      </fieldset>
      <ErrorBox error={error} />
    </Modal>
  );
}
