import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.ts';

/**
 * Writes a consistent copy of the database (VACUUM INTO) to <dataDir>/backups once a day
 * and keeps the newest `keep` copies. Safe to back up with Hyper Backup while the app runs.
 */
export function startDailyBackup(db: DB, dataDir: string, keep: number, log: (msg: string) => void): () => void {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });

  const run = () => {
    try {
      const file = path.join(dir, `bordbuch-${new Date().toISOString().slice(0, 10)}.db`);
      if (!fs.existsSync(file)) {
        db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
        log(`Datenbank-Backup erstellt: ${file}`);
      }
      const old = fs
        .readdirSync(dir)
        .filter((f) => /^bordbuch-\d{4}-\d{2}-\d{2}\.db$/.test(f))
        .sort()
        .slice(0, -keep);
      for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
    } catch (err) {
      log(`Backup fehlgeschlagen: ${(err as Error).message}`);
    }
  };

  run();
  const timer = setInterval(run, 60 * 60 * 1000); // hourly check, at most one file per day
  timer.unref();
  return () => clearInterval(timer);
}
