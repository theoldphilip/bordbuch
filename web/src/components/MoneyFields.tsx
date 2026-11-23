import { useState } from 'react';
import { PAYMENT_STATUSES } from '../format.ts';
import type { Money, PaymentStatus } from '../types.ts';
import { Field } from './ui.tsx';

const CURRENCY_KEY = 'reisebuch.currency';
/** Currency used last on this device, so a new entry does not start empty. */
export const lastCurrency = (fallback = ''): string => {
  try {
    return localStorage.getItem(CURRENCY_KEY) || fallback;
  } catch {
    return fallback;
  }
};
const rememberCurrency = (c: string) => {
  try {
    if (/^[A-Z]{3}$/.test(c)) localStorage.setItem(CURRENCY_KEY, c);
  } catch {
    /* storage can be unavailable */
  }
};

const num = (s: string): number | null | 'invalid' => {
  const t = s.trim().replace(/['\s]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
};

/**
 * Price, currency and payment state, the same for entries and the cruise.
 * Returns the form fields and a function that builds the payload part (or an error text).
 */
export function useMoneyFields(initial: Partial<Money> | undefined, defaultCurrency: string) {
  const [cost, setCost] = useState(initial?.cost != null ? String(initial.cost) : '');
  const [currency, setCurrency] = useState(initial ? (initial.currency ?? '') : defaultCurrency);
  const [status, setStatus] = useState<PaymentStatus | ''>(initial?.paymentStatus ?? '');
  const [paid, setPaid] = useState(initial?.paidAmount != null ? String(initial.paidAmount) : '');
  const [due, setDue] = useState(initial?.dueDate ?? '');

  const build = (): { error: string } | { value: Money } => {
    const c = num(cost);
    if (c === 'invalid') return { error: 'Kosten: bitte eine Zahl eingeben, z. B. 1250,50.' };
    const p = status === 'deposit' ? num(paid) : null;
    if (p === 'invalid') return { error: 'Anzahlung: bitte eine Zahl eingeben.' };
    const cur = currency.trim().toUpperCase();
    if (c !== null && cur && !/^[A-Z]{3}$/.test(cur)) return { error: 'Währung als 3-stelliger Code, z. B. EUR oder CHF.' };
    if (c !== null && cur) rememberCurrency(cur);
    return {
      value: {
        cost: c,
        currency: c !== null ? cur || null : null,
        paymentStatus: c !== null && status ? status : null,
        paidAmount: c !== null && status === 'deposit' ? p : null,
        dueDate: c !== null && status !== 'paid' && due ? due : null,
      },
    };
  };

  const fields = (
    <>
      <Field label="Kosten">
        <input inputMode="decimal" value={cost} onChange={(ev) => setCost(ev.target.value)} />
      </Field>
      <Field label="Währung">
        <input value={currency} maxLength={3} placeholder="EUR" onChange={(ev) => setCurrency(ev.target.value.toUpperCase())} />
      </Field>
      {cost.trim() && (
        <>
          <Field label="Zahlung" wide>
            <div className="segmented">
              {([['', 'keine Angabe'], ...PAYMENT_STATUSES.map((s) => [s.status, s.label])] as [PaymentStatus | '', string][]).map(([v, l]) => (
                <button key={v || 'none'} type="button" className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          {status === 'deposit' && (
            <Field label="Bereits angezahlt">
              <input inputMode="decimal" value={paid} onChange={(ev) => setPaid(ev.target.value)} />
            </Field>
          )}
          {status !== 'paid' && (
            <Field label={status === 'deposit' ? 'Rest fällig am' : 'Fällig am'} hint="freiwillig">
              <input type="date" value={due} onChange={(ev) => setDue(ev.target.value)} />
            </Field>
          )}
        </>
      )}
    </>
  );

  return { fields, build };
}
