import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api.ts';
import type { User } from '../types.ts';
import { ErrorBox, Field, Spinner } from '../components/ui.tsx';

export function AuthPage({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>('/api/setup')
      .then((r) => setNeedsSetup(r.needsSetup))
      .catch((err) => {
        setNeedsSetup(false);
        setError(errorMessage(err));
      });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = needsSetup
        ? await api.post<{ token: string; user: User }>('/api/setup', { username, displayName: displayName || username, password })
        : await api.post<{ token: string; user: User }>('/api/auth/login', { username, password, deviceName: navigator.userAgent.includes('iPhone') ? 'iPhone (Web)' : 'Browser' });
      onLogin(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (needsSetup === null) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Reisebuch</h1>
        <p className="muted">{needsSetup ? 'Willkommen! Lege das Administrator-Konto an. Weitere Familienmitglieder fügst du danach in den Einstellungen hinzu.' : 'Reisen & Kreuzfahrten planen'}</p>
        <Field label="Benutzername">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoCorrect="off" autoComplete="username" required />
        </Field>
        {needsSetup && (
          <Field label="Anzeigename">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Philip" />
          </Field>
        )}
        <Field label="Passwort" hint={needsSetup ? 'Mindestens 8 Zeichen' : undefined}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
        </Field>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Moment…' : needsSetup ? 'Konto anlegen' : 'Anmelden'}
        </button>
      </form>
      <p className="auth-version">Reisebuch {__APP_VERSION__}</p>
    </div>
  );
}
