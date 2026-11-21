import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import type { CertInfo } from '../../hooks/useDeviceSetup.ts';
import { ErrorBox } from '../../components/ui.tsx';

/** Admin: upload or remove the public HTTPS certificate (never the private key). */
export function CertificateAdmin({ cert, onChanged }: { cert: CertInfo | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/certificate', { pem: await file.text() });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Das Zertifikat aus Reisebuch entfernen? Auf der Syno und auf den Geräten bleibt es unberührt.')) return;
    try {
      await api.del('/api/certificate');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const addresses = (cert?.altNames ?? []).map((n) => n.replace(/^IP Address:|^DNS:/, ''));
  const expiring = cert?.present && cert.daysLeft !== undefined && cert.daysLeft < 60;

  return (
    <section className="card">
      <h3>Zertifikat verwalten (Admin)</h3>
      {cert?.present ? (
        <p className="muted">
          Hinterlegt für <strong>{addresses.join(', ') || cert.subject}</strong>, gültig bis {cert.validTo ? new Date(cert.validTo).toLocaleDateString('de-CH') : '?'}.
        </p>
      ) : (
        <p className="muted">Noch kein Zertifikat hinterlegt. Lade die Datei <code>bordbuch.pem</code> hoch (nur das Zertifikat, nie den privaten Schlüssel). Danach können alle in der Familie es für das iPhone herunterladen.</p>
      )}
      {expiring && <div className="alert alert-error">{cert!.daysLeft! < 0 ? 'Das Zertifikat ist abgelaufen.' : `Das Zertifikat läuft in ${cert!.daysLeft} Tagen ab.`} Erzeuge ein neues und lade es hier hoch.</div>}
      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <label className="btn">
          {busy ? 'Prüft…' : cert?.present ? 'Anderes Zertifikat hochladen' : 'Zertifikat hochladen'}
          <input type="file" accept=".pem,.crt,.cer" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {cert?.present && <button className="btn btn-danger-ghost" onClick={remove}>Entfernen</button>}
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
