import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export interface ServerVersion {
  version: string;
  builtAt: string | null;
  schema: number;
}

/** Version of the server, and whether the web app on this device is older (e.g. an open home screen app after an update). */
export function useVersion() {
  const [info, setInfo] = useState<ServerVersion | null>(null);
  useEffect(() => {
    api.get<ServerVersion>('/api/version').then(setInfo).catch(() => setInfo(null));
  }, []);
  return { info, outdated: info !== null && info.version !== __APP_VERSION__ };
}

/** Drops the cached app files and reloads, so the newest version is fetched from the server. */
export async function reloadApp(): Promise<void> {
  try {
    (await navigator.serviceWorker?.getRegistrations())?.forEach((r) => r.unregister());
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* reload anyway */
  }
  location.reload();
}
