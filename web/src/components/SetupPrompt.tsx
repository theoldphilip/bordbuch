import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeviceSetup } from '../hooks/useDeviceSetup.ts';
import { DeviceGuide } from './DeviceGuide.tsx';
import { Modal } from './ui.tsx';

const KEY = 'bordbuch.setupSeen';
const seen = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // without storage we could not remember it, so do not nag
  }
};

/** Shown once per device right after the first login, when there is something to set up. It stays available in the settings. */
export function SetupPrompt() {
  const setup = useDeviceSetup();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!setup.loading && setup.todo > 0 && !seen()) setOpen(true);
  }, [setup.loading, setup.todo]);

  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode */
    }
    setOpen(false);
  };

  if (!open) return null;
  return (
    <Modal
      title="Dieses Gerät einrichten"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Später</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => { close(); navigate('/settings/geraet'); }}>In den Einstellungen öffnen</button>
        </>
      }
    >
      <p className="muted">Damit Bordbuch auf diesem Gerät sicher läuft und dich erinnern kann, sind noch ein paar Schritte offen. Du findest sie jederzeit unter <em>Einstellungen → Dieses Gerät einrichten</em>.</p>
      <DeviceGuide steps={setup.steps} cert={setup.cert} onNavigate={close} />
    </Modal>
  );
}
