import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.ts';

/** Removes the stored files of attachments matching the WHERE clause (rows are deleted by FK cascade). */
export function unlinkAttachmentFiles(db: DB, uploadDir: string, where: string, ...params: string[]): void {
  const rows = db.prepare(`SELECT stored_name FROM attachments WHERE ${where}`).all(...params) as {
    stored_name: string;
  }[];
  for (const { stored_name } of rows) {
    fs.rm(path.join(uploadDir, stored_name), { force: true }, () => {});
  }
}
