import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.ts';

export async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordbuch-test-'));
  const app = await buildApp({ dataDir, webDir: null, defaultTz: 'Europe/Zurich', maxUploadMb: 1 });
  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload as object,
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res };
  };
  const cleanup = async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, call, cleanup, dataDir };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
