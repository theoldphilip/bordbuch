import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtSize } from '../format.ts';
import type { ImportInput } from '../aiImport.ts';

const uid = () => Math.random().toString(36).slice(2, 10);
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Collects what should be analysed: files and photos from the picker or drag & drop, screenshots
 * pasted from the clipboard (Ctrl+V / Einfügen) and pasted or typed text.
 */
export function InputCollector({ inputs, setInputs, grouped, setGrouped, disabled }: { inputs: ImportInput[]; setInputs: (fn: (prev: ImportInput[]) => ImportInput[]) => void; grouped: boolean; setGrouped: (v: boolean) => void; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const counters = useRef({ screenshot: 0, text: 0 });
  const [text, setText] = useState('');

  const addFiles = useCallback(
    (files: File[]) =>
      setInputs((prev) => [
        ...prev,
        ...files.map((file): ImportInput => {
          const isImage = file.type.startsWith('image/');
          // Clipboard images are all called "image.png"; give them a readable name.
          const generic = isImage && /^image\.\w+$/i.test(file.name);
          if (generic) {
            const n = ++counters.current.screenshot;
            const named = new File([file], `Screenshot ${n}.${EXT[file.type] ?? 'png'}`, { type: file.type });
            return { id: uid(), file: named, kind: 'screenshot', label: named.name };
          }
          return { id: uid(), file, kind: 'file', label: file.name };
        }),
      ]),
    [setInputs],
  );

  const addText = useCallback(
    (value: string) => {
      const t = value.trim();
      if (!t) return;
      const n = ++counters.current.text;
      const file = new File([t], `Eingefügter Text ${n}.txt`, { type: 'text/plain' });
      setInputs((prev) => [...prev, { id: uid(), file, kind: 'text', label: file.name }]);
    },
    [setInputs],
  );

  // Paste anywhere while the dialog is open: images become screenshots; text becomes a text input
  // unless it goes into a text field, where it is just typed in.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      const pasted = e.clipboardData?.getData('text/plain');
      if (pasted?.trim()) {
        e.preventDefault();
        addText(pasted);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles, addText, disabled]);

  const onTextareaPaste = (e: React.ClipboardEvent) => {
    // Text pastes normally; the document listener above takes care of images.
    void e;
  };

  return (
    <div
      className="collector"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <input ref={fileRef} type="file" multiple hidden accept="application/pdf,image/*,.eml,.txt,.html" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={disabled}>📎 Dateien oder Fotos wählen</button>
      <p className="muted small-print">Mehrere auf einmal sind möglich. Du kannst auch Dateien hierher ziehen.</p>

      <label className="field">
        <span className="field-label">Screenshot oder Text einfügen</span>
        <textarea
          rows={3}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onPaste={onTextareaPaste}
          placeholder="Hier tippen und einfügen (Strg+V bzw. gedrückt halten → Einfügen). Screenshots werden als Bild übernommen, Text zum Hinzufügen unten bestätigen."
        />
      </label>
      <div>
        <button type="button" className="btn small" disabled={disabled || !text.trim()} onClick={() => { addText(text); setText(''); }}>Text hinzufügen</button>
      </div>

      {inputs.length > 0 && (
        <ul className="collector-list">
          {inputs.map((i) => (
            <li key={i.id}>
              <span aria-hidden>{i.kind === 'text' ? '📝' : i.kind === 'screenshot' ? '🖼️' : i.file.type === 'application/pdf' ? '📕' : i.file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
              <span className="file-name">{i.label}</span>
              <small className="muted">{fmtSize(i.file.size)}</small>
              <button type="button" className="icon-btn small" disabled={disabled} onClick={() => setInputs((prev) => prev.filter((x) => x.id !== i.id))} aria-label={`${i.label} entfernen`}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {inputs.length >= 2 && (
        <label className="check">
          <input type="checkbox" checked={grouped} disabled={disabled} onChange={(e) => setGrouped(e.target.checked)} />
          <span>Alle zusammen als <strong>eine</strong> Unterlage auswerten<br /><small className="muted">z. B. mehrere Screenshots derselben Buchung. Sonst wird jede Datei einzeln gelesen.</small></span>
        </label>
      )}
    </div>
  );
}
