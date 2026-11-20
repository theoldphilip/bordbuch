import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../App.tsx';
import type { NotificationPrefs, Pace, User, UserSettings } from '../types.ts';
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
      <NotificationSettings />
      <CertificateSettings />
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

const LEADS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const personalLead = (minutes: number, pace: Pace) => (pace.enabled ? Math.ceil((minutes * pace.factor + pace.extraMinutes) / 5) * 5 : minutes);

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Reminders by time, delivered as push notifications (the server sends them, also when the app is closed). */
function NotificationSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [thisDevice, setThisDevice] = useState(false);
  const [devices, setDevices] = useState<{ deviceName: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const secure = window.isSecureContext;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const blocked = !secure
    ? `Dafür braucht Bordbuch eine HTTPS-Adresse. Du hast die App gerade über ${location.origin} geöffnet. Die Einrichtung steht in der README (Abschnitt „Benachrichtigungen“).`
    : ios && !standalone
      ? 'Lege Bordbuch zuerst auf den Home-Bildschirm (Teilen → Zum Home-Bildschirm) und öffne es von dort. Nur dann erlaubt iOS Benachrichtigungen.'
      : !supported
        ? 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'
        : null;

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.get<UserSettings>('/api/me/settings'));
      setDevices((await api.get<{ devices: { deviceName: string | null }[] }>('/api/push/status')).devices);
      if (!blocked) {
        const reg = await navigator.serviceWorker.ready;
        setThisDevice(!!(await reg.pushManager.getSubscription()));
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [blocked]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const patch = async (notifications: Partial<NotificationPrefs>) => {
    setError(null);
    setMsg(null);
    try {
      setSettings(await api.patch<UserSettings>('/api/me/settings', { notifications }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        throw new Error('Mitteilungen wurden nicht erlaubt. Du kannst das in den iPhone-Einstellungen unter Bordbuch ändern.');
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      const json = sub.toJSON();
      await api.post('/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys, deviceName: ios ? 'iPhone' : 'Browser' });
      await patch({ enabled: true });
      setMsg('Dieses Gerät ist angemeldet. Tippe auf „Testnachricht senden“, um es zu prüfen.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.request('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      await patch({ enabled: false });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.post<{ results: { deviceName: string | null; ok: boolean; error: string | null }[] }>('/api/push/test');
      const failed = res.results.filter((r) => !r.ok);
      setMsg(failed.length ? `Nicht zugestellt: ${failed.map((f) => `${f.deviceName ?? 'Gerät'} (${f.error})`).join(', ')}` : 'Testnachricht gesendet. Sie sollte gleich ankommen.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <ErrorBox error={error} /> : null;
  const n = settings.notifications;
  const rule = (label: string, on: boolean, lead: number, keyOn: keyof NotificationPrefs, keyLead: keyof NotificationPrefs) => {
    const personal = personalLead(lead, settings.pace);
    return (
      <div className="notify-rule">
        <label className="check">
          <input type="checkbox" checked={on} onChange={(e) => patch({ [keyOn]: e.target.checked })} />
          {label}
        </label>
        <select value={lead} disabled={!on} onChange={(e) => patch({ [keyLead]: Number(e.target.value) })} aria-label={`Vorlauf ${label}`}>
          {[...new Set([...LEADS, lead])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`} vorher</option>)}
        </select>
        {on && personal !== lead && <small className="muted">Mit deinem persönlichen Zeitbedarf: {personal} min vorher.</small>}
      </div>
    );
  };

  return (
    <section className="card">
      <h3>Erinnerungen aufs iPhone</h3>
      <p className="muted">
        Bordbuch erinnert dich nach Uhrzeit, auch wenn die App geschlossen ist: vor „Alle an Bord“, vor dem Beginn eines Ausflugs und vor
        Abflug oder Abfahrt. Dein persönlicher Zeitbedarf verlängert den Vorlauf automatisch. Standort-Erinnerungen im Hintergrund sind mit einer Web-App nicht möglich.
      </p>
      {blocked && <div className="alert alert-error">{blocked}</div>}
      {!blocked && (
        <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
          {thisDevice ? (
            <>
              <button className="btn" onClick={test} disabled={busy}>Testnachricht senden</button>
              <button className="btn btn-danger-ghost" onClick={disable} disabled={busy}>Auf diesem Gerät ausschalten</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={enable} disabled={busy}>{busy ? 'Moment…' : 'Auf diesem Gerät aktivieren'}</button>
          )}
        </div>
      )}
      {devices.length > 0 && <p className="muted small-print">Angemeldete Geräte: {devices.map((d) => d.deviceName ?? 'Gerät').join(', ')}</p>}
      {n.enabled && (
        <div className="stack">
          {rule('Alle an Bord', n.boarding, n.boardingLead, 'boarding', 'boardingLead')}
          {rule('Ausflug beginnt', n.excursion, n.excursionLead, 'excursion', 'excursionLead')}
          {rule('Abfahrt (Bahn, Bus, Fähre, Transfer)', n.transport, n.transportLead, 'transport', 'transportLead')}
          <div className="notify-rule">
            <span className="field-label">Abflug</span>
            <select value={n.flightLead} onChange={(e) => patch({ flightLead: Number(e.target.value) })} aria-label="Vorlauf Abflug">
              {[...new Set([...LEADS, n.flightLead])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`} vorher</option>)}
            </select>
            {personalLead(n.flightLead, settings.pace) !== n.flightLead && <small className="muted">Mit deinem persönlichen Zeitbedarf: {personalLead(n.flightLead, settings.pace)} min vorher.</small>}
          </div>
        </div>
      )}
      {msg && <div className="alert alert-ok">{msg}</div>}
      <ErrorBox error={error} />
    </section>
  );
}

interface CertInfo {
  present: boolean;
  subject?: string;
  validTo?: string;
  daysLeft?: number;
  altNames?: string[];
}

/** The public HTTPS certificate: the admin uploads it once, everyone can download it for the iPhone. */
function CertificateSettings() {
  const { user } = useAuth();
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<CertInfo>('/api/certificate/info').then(setInfo).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await api.put<CertInfo>('/api/certificate', { pem: await file.text() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Das Zertifikat aus Bordbuch entfernen? Auf der Syno und auf den Geräten bleibt es unberührt.')) return;
    try {
      await api.del('/api/certificate');
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!info) return error ? <ErrorBox error={error} /> : null;
  if (!info.present && !user.isAdmin) return null;
  const addresses = (info.altNames ?? []).map((n) => n.replace(/^IP Address:|^DNS:/, ''));
  const expiring = info.daysLeft !== undefined && info.daysLeft < 60;

  return (
    <section className="card">
      <h3>HTTPS-Zertifikat für das iPhone</h3>
      {info.present ? (
        <>
          <p className="muted">
            Gilt für <strong>{addresses.join(', ') || info.subject}</strong>, gültig bis {info.validTo ? new Date(info.validTo).toLocaleDateString('de-CH') : '?'}.
            Mit diesem Zertifikat vertraut das iPhone der HTTPS-Adresse der Syno. Das ist die Voraussetzung für Erinnerungen.
          </p>
          {expiring && <div className="alert alert-error">{info.daysLeft! < 0 ? 'Das Zertifikat ist abgelaufen.' : `Das Zertifikat läuft in ${info.daysLeft} Tagen ab.`} Erzeuge ein neues und lade es hier hoch.</div>}
          <div><a className="btn btn-primary" href="/api/certificate">Zertifikat herunterladen</a></div>
          <ol className="steps">
            <li>Öffne diese Seite auf dem iPhone in <strong>Safari</strong> (nicht in der Home-Bildschirm-App), zum Beispiel über die normale http-Adresse im VPN, und tippe auf <em>Zertifikat herunterladen</em>. Erlaube den Download.</li>
            <li><em>Einstellungen → Profil geladen → Installieren</em>.</li>
            <li><em>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</em>: dem Zertifikat <strong>vollständig vertrauen</strong>.</li>
            <li>Bordbuch danach über die HTTPS-Adresse öffnen und neu auf den Home-Bildschirm legen.</li>
          </ol>
        </>
      ) : (
        <p className="muted">Noch kein Zertifikat hinterlegt. Lade hier die Datei <code>bordbuch.pem</code> hoch (nur das Zertifikat, nie den privaten Schlüssel). Danach können alle in der Familie es für das iPhone herunterladen.</p>
      )}
      {user.isAdmin && (
        <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
          <label className="btn">
            {busy ? 'Prüft…' : info.present ? 'Anderes Zertifikat hochladen' : 'Zertifikat hochladen'}
            <input type="file" accept=".pem,.crt,.cer" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {info.present && <button className="btn btn-danger-ghost" onClick={remove}>Entfernen</button>}
        </div>
      )}
      <ErrorBox error={error} />
    </section>
  );
}
