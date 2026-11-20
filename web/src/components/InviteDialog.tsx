import { useMemo, useState } from 'react';
import { copyText, inviteText } from '../invite.ts';
import { Modal } from './ui.tsx';

/**
 * Invitation for a new family member with the access data, ready to send. On the iPhone the share sheet
 * (Web Share API, only on HTTPS) hands it to Messages, WhatsApp, Mail and so on. SMS and e-mail links
 * and "copy" work everywhere.
 */
export function InviteDialog({ displayName, username, password, onClose }: { displayName: string; username: string; password: string; onClose: () => void }) {
  const [withPassword, setWithPassword] = useState(true);
  const [address, setAddress] = useState(location.origin);
  const generated = useMemo(() => inviteText({ displayName, username, password: withPassword ? password : null, address }), [displayName, username, password, withPassword, address]);
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? generated;
  const [note, setNote] = useState<string | null>(null);
  const canShare = typeof navigator.share === 'function';

  const share = async () => {
    try {
      await navigator.share({ title: 'Zugang zu Bordbuch', text });
    } catch (err) {
      // Closing the share sheet is not an error.
      if ((err as Error).name !== 'AbortError') setNote('Teilen ist nicht möglich. Nutze Kopieren, Nachricht oder E-Mail.');
    }
  };
  const copy = async () => setNote((await copyText(text)) ? 'Kopiert. Du kannst den Text jetzt einfügen.' : 'Kopieren hat nicht geklappt. Markiere den Text und kopiere ihn von Hand.');

  return (
    <Modal
      title={`${displayName} einladen`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Fertig</button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">Das Konto ist angelegt. Schick {displayName} diese Nachricht, damit die Anmeldung klappt.</p>
        <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
          {canShare && <button className="btn btn-primary" onClick={share}>Teilen …</button>}
          <a className="btn" href={`sms:&body=${encodeURIComponent(text)}`}>Nachricht</a>
          <a className="btn" href={`mailto:?subject=${encodeURIComponent('Zugang zu Bordbuch')}&body=${encodeURIComponent(text)}`}>E-Mail</a>
          <button className="btn" onClick={copy}>Kopieren</button>
        </div>
        {note && <div className="alert alert-ok">{note}</div>}
        <label className="field">
          <span className="field-label">Adresse in der Nachricht</span>
          <input value={address} onChange={(e) => { setAddress(e.target.value); setEdited(null); }} inputMode="url" autoCapitalize="off" />
          <span className="field-hint">Standard ist die Adresse, über die du Bordbuch gerade geöffnet hast. Ändere sie, wenn die Familie eine andere nutzt.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={withPassword} onChange={(e) => { setWithPassword(e.target.checked); setEdited(null); }} />
          <span>Startpasswort in die Nachricht schreiben<br /><small className="muted">Ausgeschaltet schickst du das Passwort getrennt, etwa per Anruf.</small></span>
        </label>
        <label className="field">
          <span className="field-label">Nachricht</span>
          <textarea rows={12} value={text} onChange={(e) => setEdited(e.target.value)} />
        </label>
        <p className="privacy-note">Das Startpasswort steht im Klartext in der Nachricht. Schicke sie nur an die Person selbst. {displayName} sollte es nach der ersten Anmeldung unter <em>Einstellungen → Konto</em> ändern.</p>
      </div>
    </Modal>
  );
}
