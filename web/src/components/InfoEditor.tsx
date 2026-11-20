import type { Info, InfoKind } from '../types.ts';

export const KIND_LABELS: Record<InfoKind, string> = { phone: 'Telefon', emergency: 'Notruf', email: 'E-Mail', link: 'Link', text: 'Hinweis' };
export const KIND_ICONS: Record<InfoKind, string> = { phone: '☎️', emergency: '🆘', email: '✉️', link: '🔗', text: 'ℹ️' };

/** tel:, mailto: or https link for an info, or null when it can't be opened. */
export function infoHref(i: Info): string | null {
  if (i.kind === 'phone' || i.kind === 'emergency') {
    const digits = i.value.replace(/\(.*?\)/g, '').replace(/[^\d+]/g, '').slice(0, 20);
    return digits.replace('+', '').length >= 3 ? `tel:${digits}` : null;
  }
  if (i.kind === 'email') return /^\S+@\S+$/.test(i.value.trim()) ? `mailto:${i.value.trim()}` : null;
  if (i.kind === 'link') return /^https?:\/\//i.test(i.value.trim()) ? i.value.trim() : null;
  return null;
}

export const AI_NOTE = 'KI-Wissen, bitte prüfen';

/** Compact read-only list, used in review cards. */
export function InfoSummary({ infos }: { infos: Info[] }) {
  if (!infos.length) return null;
  return (
    <ul className="info-summary">
      {infos.map((i, n) => (
        <li key={n} className={i.kind === 'emergency' ? 'emergency' : ''}>
          <span aria-hidden>{KIND_ICONS[i.kind]}</span> <strong>{i.label}:</strong> {i.value}
          {i.source === 'ai' && <small className="info-ai"> · {AI_NOTE}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Editable list of additional infos with tap-to-call links. */
export function InfoEditor({ infos, onChange }: { infos: Info[]; onChange: (infos: Info[]) => void }) {
  const set = (n: number, patch: Partial<Info>) =>
    // Changing text of an AI-supplied info makes it the user's own.
    onChange(infos.map((i, k) => (k === n ? { ...i, ...patch, ...('label' in patch || 'value' in patch ? { source: 'user' as const } : {}) } : i)));
  const add = (kind: InfoKind, label: string) => onChange([...infos, { label, value: '', kind, source: 'user' }]);

  return (
    <div className="info-editor">
      {infos.map((i, n) => {
        const href = infoHref(i);
        return (
          <div className={`info-row${i.kind === 'emergency' ? ' emergency' : ''}`} key={n}>
            <select value={i.kind} onChange={(e) => set(n, { kind: e.target.value as InfoKind })} aria-label="Art der Info">
              {(Object.keys(KIND_LABELS) as InfoKind[]).map((k) => <option key={k} value={k}>{KIND_ICONS[k]} {KIND_LABELS[k]}</option>)}
            </select>
            <input value={i.label} onChange={(e) => set(n, { label: e.target.value })} placeholder="Bezeichnung, z. B. Rezeption" aria-label="Bezeichnung" />
            <input value={i.value} onChange={(e) => set(n, { value: e.target.value })} placeholder={i.kind === 'text' ? 'Hinweis' : i.kind === 'email' ? 'name@beispiel.ch' : i.kind === 'link' ? 'https://…' : '+39 06 1234 567'} inputMode={i.kind === 'phone' || i.kind === 'emergency' ? 'tel' : undefined} aria-label="Wert" />
            {href && <a className="btn small info-call" href={href}>{i.kind === 'email' ? 'Mail' : i.kind === 'link' ? 'Öffnen' : 'Anrufen'}</a>}
            <button type="button" className="icon-btn small" onClick={() => onChange(infos.filter((_, k) => k !== n))} aria-label="Info entfernen">✕</button>
            {i.source === 'ai' && <small className="info-ai wide-row">{AI_NOTE}: Nummer aus dem allgemeinen Wissen der KI, nicht aus deinen Unterlagen.</small>}
            {i.source === 'document' && <small className="muted wide-row">aus deinem Dokument</small>}
          </div>
        );
      })}
      <div className="info-add">
        <button type="button" className="btn small" onClick={() => add('emergency', 'Notruf')}>+ Notruf</button>
        <button type="button" className="btn small" onClick={() => add('phone', '')}>+ Telefon</button>
        <button type="button" className="btn small" onClick={() => add('text', '')}>+ Hinweis</button>
      </div>
    </div>
  );
}
