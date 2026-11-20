import { useEffect, type ReactNode } from 'react';
import { COMMON_TIMEZONES } from '../format.ts';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert alert-error" role="alert">{error}</div>;
}

let tzListCache: string[] | null = null;
function allTimezones(): string[] {
  if (!tzListCache) {
    try {
      tzListCache = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      tzListCache = COMMON_TIMEZONES;
    }
  }
  return tzListCache;
}

/** Free-text time zone input with suggestions. Empty = inherit. */
export function TimezoneInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <>
      <input list="tz-list" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim())} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <datalist id="tz-list">
        {[...new Set([...COMMON_TIMEZONES, ...allTimezones()])].map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
    </>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Lädt…" />;
}
