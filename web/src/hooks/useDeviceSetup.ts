import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';

export interface CertInfo {
  present: boolean;
  subject?: string;
  validTo?: string;
  daysLeft?: number;
  altNames?: string[];
}

/** What this browser can do for push notifications, and why not. */
export function getPushSupport() {
  const secure = window.isSecureContext;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const blocked = !secure
    ? `Dafür braucht Bordbuch eine HTTPS-Adresse. Du hast die App gerade über ${location.origin} geöffnet.`
    : ios && !standalone
      ? 'Lege Bordbuch zuerst auf den Home-Bildschirm (Teilen → Zum Home-Bildschirm) und öffne es von dort. Nur dann erlaubt iOS Benachrichtigungen.'
      : !supported
        ? 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'
        : null;
  return { secure, ios, standalone, supported, blocked };
}

export type StepState = 'done' | 'todo' | 'blocked';
export interface SetupStep {
  id: 'cert' | 'home' | 'push';
  title: string;
  state: StepState;
  /** Why a step is blocked. */
  note?: string;
}

/** The setup steps that apply to this device, in the order they must be done. */
export function computeSteps(input: { cert: CertInfo | null; isAdmin: boolean; subscribed: boolean }): SetupStep[] {
  const { secure, ios, standalone, supported } = getPushSupport();
  const steps: SetupStep[] = [];

  if (location.protocol === 'https:') steps.push({ id: 'cert', title: 'Zertifikat installieren', state: 'done' });
  else if (input.cert?.present || input.isAdmin) steps.push({ id: 'cert', title: 'Zertifikat installieren', state: 'todo' });

  if (ios) steps.push({ id: 'home', title: 'Zum Home-Bildschirm hinzufügen', state: standalone ? 'done' : 'todo' });

  if (!secure) steps.push({ id: 'push', title: 'Erinnerungen aktivieren', state: 'blocked', note: 'Braucht zuerst eine HTTPS-Adresse (Schritt 1).' });
  else if (ios && !standalone) steps.push({ id: 'push', title: 'Erinnerungen aktivieren', state: 'blocked', note: 'Braucht zuerst die App auf dem Home-Bildschirm.' });
  else if (supported) steps.push({ id: 'push', title: 'Erinnerungen aktivieren', state: input.subscribed ? 'done' : 'todo' });
  return steps;
}

export function useDeviceSetup() {
  const { user } = useAuth();
  const [cert, setCert] = useState<CertInfo | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCert(await api.get<CertInfo>('/api/certificate/info'));
    } catch {
      setCert(null);
    }
    const { secure, supported, ios, standalone } = getPushSupport();
    if (secure && supported && !(ios && !standalone)) {
      try {
        // The service worker is only registered in the built app; do not wait forever in development.
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
        setSubscribed(reg ? !!(await reg.pushManager.getSubscription()) : false);
      } catch {
        setSubscribed(false);
      }
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const steps = useMemo(() => computeSteps({ cert, isAdmin: user.isAdmin, subscribed }), [cert, user.isAdmin, subscribed]);
  return { loading, cert, steps, todo: steps.filter((s) => s.state === 'todo').length, refresh };
}
