import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useAuth } from '../../App.tsx';
import type { User } from '../../types.ts';
import { ErrorBox, Field } from '../../components/ui.tsx';

export function ProfileSettings() {
  const { user, setUser, logout } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async () => {
    setError(null);
    setMsg(null);
    try {
      const u = await api.patch<User>('/api/me', {
        displayName,
        ...(newPassword ? { currentPassword, newPassword } : {}),
      });
      setUser(u);
      setCurrentPassword('');
      setNewPassword('');
      setMsg(newPassword ? 'Gespeichert. Andere Geräte wurden abgemeldet.' : 'Gespeichert.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card form">
      <h3 className="wide">Mein Profil</h3>
      <Field label="Anzeigename" wide><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
      <Field label="Aktuelles Passwort"><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="Neues Passwort"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
      <div className="wide btn-row">
        <button className="btn btn-primary" onClick={saveProfile}>Speichern</button>
        <button className="btn btn-danger-ghost" onClick={logout}>Abmelden</button>
      </div>
      {msg && <div className="alert alert-ok wide">{msg}</div>}
      <ErrorBox error={error} />
      <p className="muted small-print wide">Angemeldet als {user.username}</p>
    </section>
  );
}
