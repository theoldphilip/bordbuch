import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.ts';

export async function setup(opts: Parameters<typeof buildApp>[1] = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordbuch-test-'));
  const app = await buildApp({ dataDir, webDir: null, defaultTz: 'Europe/Zurich', maxUploadMb: 1, anthropicApiKey: null, aiModel: 'test-model' }, opts);
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

/** Multipart upload through app.inject (field name "file"). */
export async function upload(
  app: Awaited<ReturnType<typeof setup>>['app'],
  token: string,
  url: string,
  filename: string,
  mime: string,
  content: string | Buffer,
) {
  const boundary = '----bordbuch-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  return { status: res.statusCode, body: res.json() as any };
}
