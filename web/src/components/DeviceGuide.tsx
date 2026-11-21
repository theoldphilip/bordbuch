import { Link } from 'react-router-dom';
import type { CertInfo, SetupStep } from '../hooks/useDeviceSetup.ts';

const ICONS = { done: '✅', todo: '⬜', blocked: '⏸️' } as const;

/** The steps to set up an iPhone: install the certificate, add to the home screen, switch on reminders. */
export function DeviceGuide({ steps, cert, onNavigate }: { steps: SetupStep[]; cert: CertInfo | null; onNavigate?: () => void }) {
  if (steps.length === 0) return <p className="muted">Für dieses Gerät ist nichts einzurichten.</p>;
  return (
    <ol className="guide">
      {steps.map((s, i) => (
        <li key={s.id} className={`guide-step ${s.state}`}>
          <span className="guide-icon" aria-hidden>{ICONS[s.state]}</span>
          <div className="guide-body">
            <strong>{i + 1}. {s.title}</strong>
            {s.state === 'blocked' && <p className="muted">{s.note}</p>}

            {s.id === 'cert' && s.state === 'done' && <p className="muted">Diese Seite läuft über HTTPS, das Zertifikat ist auf diesem Gerät eingerichtet.</p>}
            {s.id === 'cert' && s.state === 'todo' && cert?.present && (
              <>
                <p className="muted">Damit vertraut dein iPhone der sicheren Adresse. Das geht nur einmal pro Gerät und ist die Voraussetzung für Erinnerungen.</p>
                <div><a className="btn btn-primary" href="/api/certificate">Zertifikat herunterladen</a></div>
                <ol className="steps">
                  <li>Öffne diese Seite in <strong>Safari</strong> (nicht in der Home-Bildschirm-App) und tippe oben auf <em>Zertifikat herunterladen</em>. Erlaube den Download.</li>
                  <li><em>Einstellungen → Profil geladen → Installieren</em>.</li>
                  <li><em>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</em>: dem Zertifikat <strong>vollständig vertrauen</strong>.</li>
                  <li>Öffne Reisebuch danach über die HTTPS-Adresse.</li>
                </ol>
              </>
            )}
            {s.id === 'cert' && s.state === 'todo' && !cert?.present && <p className="muted">Lade zuerst das Zertifikat unten hoch. Dann steht es für alle bereit.</p>}

            {s.id === 'home' && s.state === 'done' && <p className="muted">Reisebuch läuft als App vom Home-Bildschirm.</p>}
            {s.id === 'home' && s.state === 'todo' && (
              <p className="muted">
                Öffne Reisebuch in Safari über die <strong>HTTPS-Adresse</strong>, tippe auf <em>Teilen</em> und wähle <em>Zum Home-Bildschirm</em>. Öffne es danach von dort. Die Kachel merkt sich die Adresse, über die du sie angelegt hast.
              </p>
            )}

            {s.id === 'push' && s.state === 'done' && <p className="muted">Dieses Gerät erhält Erinnerungen.</p>}
            {s.id === 'push' && s.state === 'todo' && (
              <div>
                <Link className="btn btn-primary" to="/settings/erinnerungen" onClick={onNavigate}>Erinnerungen einrichten</Link>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
