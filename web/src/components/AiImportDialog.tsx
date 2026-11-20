import { useState } from 'react';
import { errorMessage } from '../api.ts';
import { failedText, runImport, type ImportInput } from '../aiImport.ts';
import { InputCollector } from './InputCollector.tsx';
import { ErrorBox, Modal } from './ui.tsx';

/** Add documents, screenshots and text to an existing trip and let the AI sort them in. */
export function AiImportDialog({ tripId, onClose, onReady, onNotice }: { tripId: string; onClose: () => void; onReady: (attachmentIds: string[]) => void; onNotice: (text: string | null) => void }) {
  const [inputs, setInputs] = useState<ImportInput[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setProgress('Startet…');
    try {
      const res = await runImport(tripId, inputs, grouped, setProgress);
      onNotice(res.failed.length ? `Nicht gelesen:\n${failedText(res.failed)}` : null);
      onClose();
      onReady(res.ready);
    } catch (err) {
      setError(errorMessage(err));
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <Modal
      title="Dokumente mit KI zuordnen"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="btn btn-primary" onClick={start} disabled={busy || inputs.length === 0}>{busy ? 'Analysiert…' : `Analysieren (${inputs.length})`}</button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">Buchungsbestätigungen, Tickets, Reisepläne, Screenshots oder kopierter Text. Die KI legt die Einträge an oder ergänzt vorhandene. Du prüfst alles, bevor es gespeichert wird.</p>
        <InputCollector inputs={inputs} setInputs={setInputs} grouped={grouped} setGrouped={setGrouped} disabled={busy} />
        {progress && <p className="muted">{progress}. Das kann pro Unterlage bis zu einer Minute dauern.</p>}
        <p className="privacy-note">Der Inhalt wird zur Analyse an die Claude-API von Anthropic gesendet.</p>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
