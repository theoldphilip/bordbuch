import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../App.tsx';
import type { Pace, User, UserSettings } from '../types.ts';
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
      <PaceSettings />
      {user.isAdmin && <AiAdmin />}
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

function AiAdmin() {
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ enabled: boolean; model: string | null }>('/api/ai/status').then(setStatus).catch(() => {});
  }, []);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ model: string }>('/api/ai/check');
      setResult({ ok: true, text: `Verbindung steht (Modell ${r.model}).` });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Dokumente automatisch zuordnen (KI)</h3>
      {status === null ? null : status.enabled ? (
        <>
          <p className="muted">Aktiv mit Modell <strong>{status.model}</strong>. Hochgeladene Dokumente werden zur Analyse an die Claude-API gesendet.</p>
          <div><button className="btn" onClick={test} disabled={busy}>{busy ? 'Prüft…' : 'Verbindung testen'}</button></div>
          {result && <div className={`alert ${result.ok ? 'alert-ok' : 'alert-error'}`}>{result.text}</div>}
        </>
      ) : (
        <p className="muted">Nicht eingerichtet. Auf dem Server fehlt <code>ANTHROPIC_API_KEY</code>. Die Anleitung steht in der README.</p>
      )}
    </section>
  );
}

const FACTORS = [1.25, 1.5, 1.75, 2, 2.5, 3];

/** Recommended times are multiplied by a personal factor. Always shown next to the normal time. */
function PaceSettings() {
  const [pace, setPace] = useState<Pace | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<UserSettings>('/api/me/settings').then((s) => setPace(s.pace)).catch((e) => setError(errorMessage(e)));
  }, []);

  const save = async (next: Pace) => {
    setPace(next);
    setSaved(false);
    setError(null);
    try {
      setPace((await api.patch<UserSettings>('/api/me/settings', { pace: next })).pace);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!pace) return error ? <ErrorBox error={error} /> : null;
  const example = Math.ceil((30 * pace.factor + pace.extraMinutes) / 5) * 5;

  return (
    <section className="card">
      <h3>Persönlicher Zeitbedarf</h3>
      <p className="muted">
        Für Wege, Ein- und Ausstiege, Transfers und Check-ins, bei denen du mehr Zeit brauchst als üblich. Alle empfohlenen Mindestzeiten
        (Anreise zum Schiff, Ausschiffung, Rückkehr von Ausflügen, Hotel-Check-out) werden dann mit deinem Faktor gerechnet. Angezeigt
        werden immer <strong>beide Zeiten</strong>: normal und persönlich. Die Einstellung gilt nur für dein Konto.
      </p>
      <label className="check">
        <input type="checkbox" checked={pace.enabled} onChange={(e) => save({ ...pace, enabled: e.target.checked })} />
        Persönlichen Zeitbedarf berücksichtigen
      </label>
      <div className="form" style={{ opacity: pace.enabled ? 1 : 0.55 }}>
        <label className="field">
          <span className="field-label">Faktor</span>
          <select value={pace.factor} disabled={!pace.enabled} onChange={(e) => save({ ...pace, factor: Number(e.target.value) })}>
            {[...new Set([...FACTORS, pace.factor])].sort((a, b) => a - b).map((f) => <option key={f} value={f}>× {String(f).replace('.', ',')}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Zusatzzeit pauschal</span>
          <select value={pace.extraMinutes} disabled={!pace.enabled} onChange={(e) => save({ ...pace, extraMinutes: Number(e.target.value) })}>
            {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? 'keine' : `+ ${m} min`}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small-print">Beispiel: Aus einer empfohlenen Zeit von 30 min werden <strong>{pace.enabled ? `${example} min` : '30 min (aus)'}</strong>.</p>
      {saved && <div className="alert alert-ok">Gespeichert.</div>}
      <ErrorBox error={error} />
    </section>
  );
}
