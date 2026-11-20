import type { DB } from './db.ts';
import { userSettingsInput, type UserSettings } from './schemas.ts';

export function readSettings(db: DB, userId: string): UserSettings {
  const row = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId) as { settings: string } | undefined;
  try {
    return userSettingsInput.parse(JSON.parse(row?.settings ?? '{}'));
  } catch {
    return userSettingsInput.parse({});
  }
}

export function writeSettings(db: DB, userId: string, settings: UserSettings): void {
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), userId);
}
