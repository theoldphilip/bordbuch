import { Link, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../App.tsx';
import { useDeviceSetup } from '../hooks/useDeviceSetup.ts';
import { useVersion } from '../hooks/useVersion.ts';
import { AboutSettings } from './settings/About.tsx';
import { AiAdmin } from './settings/Ai.tsx';
import { DeviceSettings } from './settings/Device.tsx';
import { FamilyAdmin } from './settings/Family.tsx';
import { NotificationSettings } from './settings/Notifications.tsx';
import { PaceSettings } from './settings/Pace.tsx';
import { ProfileSettings } from './settings/Profile.tsx';

const SECTIONS = [
  { id: 'konto', icon: '👤', title: 'Konto', sub: 'Name, Passwort, Abmelden' },
  { id: 'zeit', icon: '⏱️', title: 'Zeitbedarf', sub: 'Eigenes Tempo bei Mindestzeiten' },
  { id: 'erinnerungen', icon: '🔔', title: 'Erinnerungen', sub: 'Benachrichtigungen aufs iPhone' },
  { id: 'geraet', icon: '📱', title: 'Dieses Gerät einrichten', sub: 'Zertifikat, Home-Bildschirm' },
  { id: 'familie', icon: '👪', title: 'Familie', sub: 'Konten verwalten', admin: true },
  { id: 'ki', icon: '✨', title: 'KI und Dokumente', sub: 'Verbindung zur Claude-API', admin: true },
  { id: 'ueber', icon: 'ℹ️', title: 'Über Reisebuch', sub: 'Version und Stand' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const VIEWS: Record<SectionId, () => React.ReactElement> = {
  konto: () => <ProfileSettings />,
  zeit: () => <PaceSettings />,
  erinnerungen: () => <NotificationSettings />,
  geraet: () => <DeviceSettings />,
  familie: () => <FamilyAdmin />,
  ki: () => <AiAdmin />,
  ueber: () => <AboutSettings />,
};

/**
 * Settings as a list of short pages. On the phone the list comes first and each entry opens its own
 * page; on a wide screen the list stays on the left and the page opens next to it.
 */
export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const { user } = useAuth();
  const setup = useDeviceSetup();
  const version = useVersion();
  const items = SECTIONS.filter((s) => !('admin' in s) || user.isAdmin);
  const active = items.find((s) => s.id === section) ?? items[0]!;

  return (
    <div className={`settings${section ? ' has-section' : ''}`}>
      <nav className="settings-nav" aria-label="Einstellungen">
        <h1>Einstellungen</h1>
        {items.map((s) => (
          <NavLink key={s.id} to={`/settings/${s.id}`} className={() => `settings-link${s.id === active.id ? ' active' : ''}`}>
            <span className="icon" aria-hidden>{s.icon}</span>
            <span className="settings-link-text">
              <strong>{s.title}</strong>
              <small>{s.id === 'ueber' ? `Version ${version.info?.version ?? __APP_VERSION__}` : s.sub}</small>
            </span>
            {s.id === 'ueber' && version.outdated && <span className="nav-badge" title="Die App auf diesem Gerät ist veraltet">!</span>}
            {s.id === 'geraet' && setup.todo > 0 && <span className="nav-badge" title="Offene Schritte">{setup.todo}</span>}
            <span className="chev" aria-hidden>›</span>
          </NavLink>
        ))}
        <p className="muted small-print">Reisebuch · angemeldet als {user.username}</p>
      </nav>
      <div className="settings-content">
        <Link to="/settings" className="back-link">‹ Einstellungen</Link>
        {VIEWS[active.id]()}
      </div>
    </div>
  );
}
