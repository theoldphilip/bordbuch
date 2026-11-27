import type { AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { loadCruises, loadItems } from './model.ts';
import { deliverToUser, usersWithDevices, type Senders } from './push.ts';
import { buildReminders, dueReminders } from './reminders.ts';
import { readSettings } from './settings.ts';

type Row = Record<string, any>;

/**
 * One pass of the reminder scheduler. For every user with a device (browser or iPhone app) and enabled reminders it
 * looks at all their trips and sends what is due. Returns how many reminders were sent.
 */
export async function runReminderTick(
  { db, config, sender, apns = null }: { db: DB; config: Pick<AppConfig, 'defaultTz'> } & Pick<Senders, 'sender'> & Partial<Pick<Senders, 'apns'>>,
  now = Date.now(),
): Promise<number> {
  let sent = 0;
  for (const userId of usersWithDevices(db, !!apns)) {
    const settings = readSettings(db, userId);
    if (!settings.notifications.enabled) continue;
    const trips = db
      .prepare('SELECT t.id FROM trips t JOIN trip_members m ON m.trip_id = t.id WHERE m.user_id = ?')
      .all(userId) as Row[];
    for (const { id: tripId } of trips) {
      const reminders = dueReminders(
        buildReminders({ tripId, cruises: loadCruises(db, tripId), items: loadItems(db, tripId), defaultTz: config.defaultTz, settings }),
        now,
      );
      for (const r of reminders) {
        // The log entry is the lock: whoever inserts it first sends.
        const fresh = db.prepare('INSERT OR IGNORE INTO push_log (user_id, key, sent_at) VALUES (?, ?, ?)').run(userId, r.key, new Date(now).toISOString());
        if (Number(fresh.changes) === 0) continue;
        await deliverToUser(db, { sender, apns }, userId, { title: r.title, body: r.body, url: r.url, tag: r.key });
        sent++;
      }
    }
  }
  db.prepare('DELETE FROM push_log WHERE sent_at < ?').run(new Date(now - 30 * 24 * 3_600_000).toISOString());
  return sent;
}
