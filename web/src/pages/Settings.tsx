import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../App.tsx';
import type { User } from '../types.ts';
import { ErrorBox, Field } from '../components/ui.tsx';

export function SettingsPage() {
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
    <div className="page narrow">
      <h1>Einstellungen</h1>
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
      </section>
      {user.isAdmin && <FamilyAdmin />}
      <p className="muted center">Bordbuch · angemeldet als {user.username}</p>
    </div>
  );
}

function FamilyAdmin() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<User[]>('/api/users').then(setUsers).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    setError(null);
    try {
      await api.post('/api/users', { username, displayName: displayName || username, password });
      setUsername('');
      setDisplayName('');
      setPassword('');
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const resetPw = async (u: User) => {
    const pw = prompt(`Neues Passwort für ${u.displayName} (min. 8 Zeichen):`);
    if (!pw) return;
    try {
      await api.post(`/api/users/${u.id}/password`, { password: pw });
      alert('Passwort geändert.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (u: User) => {
    if (!confirm(`${u.displayName} löschen? Reisen, die nur ${u.displayName} gehören, gehen an dich über.`)) return;
    try {
      await api.del(`/api/users/${u.id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card">
      <h3>Familie</h3>
      <ul className="member-list">
        {users.map((u) => (
          <li key={u.id}>
            <span className="avatar small">{u.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="member-name">{u.displayName} <small className="muted">@{u.username}{u.isAdmin ? ' · Admin' : ''}</small></span>
            {u.id !== user.id && (
              <>
                <button className="btn btn-ghost small" onClick={() => resetPw(u)}>Passwort</button>
                <button className="icon-btn small" onClick={() => remove(u)} aria-label={`${u.displayName} löschen`}>🗑</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="form">
        <Field label="Benutzername"><input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" /></Field>
        <Field label="Anzeigename"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Startpasswort" wide><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
        <div className="wide"><button className="btn btn-primary" onClick={add} disabled={!username || password.length < 8}>Familienmitglied anlegen</button></div>
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
