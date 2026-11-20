import type { AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { loadCruises, loadItems } from './model.ts';
import type { PushSender } from './push.ts';
import { buildReminders, dueReminders } from './reminders.ts';
import { readSettings } from './settings.ts';

type Row = Record<string, any>;

/**
 * One pass of the reminder scheduler. For every user with a subscribed device and enabled reminders it
 * looks at all their trips and sends what is due. Returns how many reminders were sent.
 */
export async function runReminderTick(
  { db, config, sender }: { db: DB; config: Pick<AppConfig, 'defaultTz'>; sender: PushSender },
  now = Date.now(),
): Promise<number> {
  const users = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all() as Row[];
  let sent = 0;
  for (const { user_id: userId } of users) {
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
        const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as Row[];
        for (const s of subs) {
          const res = await sender.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: r.title, body: r.body, url: r.url, tag: r.key });
          if (res.gone) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        }
        sent++;
      }
    }
  }
  db.prepare('DELETE FROM push_log WHERE sent_at < ?').run(new Date(now - 30 * 24 * 3_600_000).toISOString());
  return sent;
}
