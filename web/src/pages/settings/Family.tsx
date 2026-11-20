import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useAuth } from '../../App.tsx';
import type { User } from '../../types.ts';
import { ErrorBox, Field } from '../../components/ui.tsx';

export function FamilyAdmin() {
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
