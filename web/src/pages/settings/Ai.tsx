import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { ErrorBox } from '../../components/ui.tsx';

export function AiAdmin() {
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ enabled: boolean; model: string | null }>('/api/ai/status').then(setStatus).catch(() => {});
  }, []);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ model: string }>('/api/ai/check');
      setResult({ ok: true, text: `Verbindung steht (Modell ${r.model}).` });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Dokumente automatisch zuordnen (KI)</h3>
      {status === null ? null : status.enabled ? (
        <>
          <p className="muted">Aktiv mit Modell <strong>{status.model}</strong>. Hochgeladene Dokumente werden zur Analyse an die Claude-API gesendet.</p>
          <div><button className="btn" onClick={test} disabled={busy}>{busy ? 'Prüft…' : 'Verbindung testen'}</button></div>
          {result && <div className={`alert ${result.ok ? 'alert-ok' : 'alert-error'}`}>{result.text}</div>}
        </>
      ) : (
        <p className="muted">Nicht eingerichtet. Auf dem Server fehlt <code>ANTHROPIC_API_KEY</code>. Die Anleitung steht in der README.</p>
      )}
    </section>
  );
}
