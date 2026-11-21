import { TRIP_KINDS } from '../format.ts';
import type { TripKind } from '../types.ts';

/** Choice of the kind of trip: which parts of the app a trip shows depends on it. */
export function KindPicker({ value, onChange, disabled, extra }: { value: TripKind | 'auto'; onChange: (k: TripKind | 'auto') => void; disabled?: boolean; extra?: { value: 'auto'; label: string; icon: string; hint: string } }) {
  const options = [...(extra ? [extra] : []), ...TRIP_KINDS.map((k) => ({ value: k.kind as TripKind | 'auto', label: k.label, icon: k.icon, hint: k.hint }))];
  return (
    <div className="kind-picker" role="radiogroup" aria-label="Art der Reise">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} className={`kind-option${value === o.value ? ' active' : ''}`} onClick={() => onChange(o.value)}>
          <span className="kind-icon" aria-hidden>{o.icon}</span>
          <span><strong>{o.label}</strong><small>{o.hint}</small></span>
        </button>
      ))}
    </div>
  );
}
