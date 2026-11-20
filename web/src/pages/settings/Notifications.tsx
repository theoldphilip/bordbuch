import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Link } from 'react-router-dom';
import { getPushSupport } from '../../hooks/useDeviceSetup.ts';
import type { NotificationPrefs, Pace, UserSettings } from '../../types.ts';
import { ErrorBox } from '../../components/ui.tsx';

const LEADS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const personalLead = (minutes: number, pace: Pace) => (pace.enabled ? Math.ceil((minutes * pace.factor + pace.extraMinutes) / 5) * 5 : minutes);

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Reminders by time, delivered as push notifications (the server sends them, also when the app is closed). */
export function NotificationSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [thisDevice, setThisDevice] = useState(false);
  const [devices, setDevices] = useState<{ deviceName: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { ios, blocked } = getPushSupport();

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
      {blocked && (
        <div className="alert alert-error">
          {blocked} <Link to="/settings/geraet">Zur Geräte-Einrichtung</Link>
        </div>
      )}
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
