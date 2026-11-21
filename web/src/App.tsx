import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.ts';
import type { User } from './types.ts';
import { AuthPage } from './pages/Auth.tsx';
import { TripsPage } from './pages/Trips.tsx';
import { TripPage } from './pages/Trip.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { Spinner } from './components/ui.tsx';
import { SetupPrompt } from './components/SetupPrompt.tsx';

interface AuthCtx {
  user: User;
  setUser: (u: User) => void;
  logout: () => void;
}
const AuthContext = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(AuthContext)!;

/** Main navigation: at the bottom on the phone, in the top bar on wide screens. */
function BottomNav() {
  const { pathname } = useLocation();
  const onTrips = pathname === '/' || pathname.startsWith('/trips');
  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      <Link to="/" className={onTrips ? 'active' : ''} aria-current={onTrips ? 'page' : undefined}>
        <span className="nav-icon" aria-hidden>🧭</span>
        <span>Reisen</span>
      </Link>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="nav-icon" aria-hidden>⚙️</span>
        <span>Einstellungen</span>
      </NavLink>
    </nav>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!api.token);
  const [offline, setOffline] = useState(false);

  const logout = useCallback(() => {
    if (api.token) api.post('/api/auth/logout').catch(() => {});
    api.setToken(null);
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    setUser(null);
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      api.setToken(null);
      setUser(null);
    });
    api.onOffline(setOffline);
    if (!api.token) return;
    api
      .get<User>('/api/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center-screen"><Spinner /></div>;
  if (!user) {
    return (
      <AuthPage
        onLogin={(token, u) => {
          api.setToken(token);
          setUser(u);
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <BrowserRouter>
        <div className="app">
          <header className="topbar">
            <Link to="/" className="brand">
              <img src="/icon.svg" alt="" width={28} height={28} />
              <span>Reisebuch</span>
            </Link>
            <nav className="top-links" aria-label="Hauptnavigation">
              <NavLink to="/" end>Reisen</NavLink>
              <NavLink to="/settings">Einstellungen</NavLink>
            </nav>
            <span className="spacer" />
            <Link to="/settings/konto" className="avatar" title="Einstellungen" aria-label="Einstellungen">
              {user.displayName.slice(0, 1).toUpperCase()}
            </Link>
          </header>
          {offline && <div className="offline-banner">Offline – du siehst den zuletzt geladenen Stand.</div>}
          <main className="content">
            <Routes>
              <Route path="/" element={<TripsPage />} />
              <Route path="/trips/:tripId" element={<TripPage />} />
              <Route path="/settings/:section?" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <BottomNav />
          <SetupPrompt />
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
