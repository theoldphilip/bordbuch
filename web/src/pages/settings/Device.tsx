import { useAuth } from '../../App.tsx';
import { DeviceGuide } from '../../components/DeviceGuide.tsx';
import { Spinner } from '../../components/ui.tsx';
import { useDeviceSetup } from '../../hooks/useDeviceSetup.ts';
import { CertificateAdmin } from './Certificate.tsx';

export function DeviceSettings() {
  const { user } = useAuth();
  const setup = useDeviceSetup();
  return (
    <div className="stack">
      <section className="card">
        <h3>Dieses Gerät einrichten</h3>
        <p className="muted">Einmal pro iPhone: Zertifikat installieren, die App auf den Home-Bildschirm legen und Erinnerungen einschalten.</p>
        {setup.loading ? <Spinner /> : <DeviceGuide steps={setup.steps} cert={setup.cert} />}
      </section>
      {user.isAdmin && <CertificateAdmin cert={setup.cert} onChanged={setup.refresh} />}
    </div>
  );
}
