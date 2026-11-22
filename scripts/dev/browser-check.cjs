const { chromium, devices } = require('playwright');
// Beispiel für einen Browsertest mit Playwright und gefälschter Uhr (Ansichtsmodus, Quittieren, Lesen ohne Ändern).
// Voraussetzung: fake-server läuft (Port 8091), `playwright` ist installiert.  Aufruf: node scripts/dev/browser-check.cjs <ausgabeordner>
const out = process.argv[2] || '.';
const B = process.env.BASE || 'http://localhost:8091';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('bordbuch.setupSeen', '1'));
  await ctx.clock.install({ time: new Date('2027-05-11T08:30:00Z') });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  // Daten über die API anlegen
  await p.request.post(B + '/api/setup', { data: { username: 'philip', displayName: 'Philip', password: 'bordbuch123' } });
  const tok = (await (await p.request.post(B + '/api/auth/login', { data: { username: 'philip', password: 'bordbuch123' } })).json()).token;
  const h = { authorization: 'Bearer ' + tok };
  const trip = (await (await p.request.post(B + '/api/trips', { headers: h, data: { title: 'Testreise', kind: 'cruise' } })).json()).trip.id;
  const cruise = await (await p.request.post(B + `/api/trips/${trip}/cruises`, { headers: h, data: { shipName: 'MS Test', days: [
    { date: '2027-05-10', kind: 'embarkation', portName: 'Rom', timezone: 'Europe/Rome', arrival: '12:00', allAboard: '16:30', departure: '17:00' },
    { date: '2027-05-11', kind: 'port', portName: 'Neapel', timezone: 'Europe/Rome', arrival: '08:00', allAboard: '17:30', departure: '18:00', infos: [{ label: 'Agentur', value: '+39 081 123456', kind: 'phone', source: 'user' }] },
    { date: '2027-05-12', kind: 'disembarkation', portName: 'Rom', timezone: 'Europe/Rome', arrival: '07:00' } ] } })).json();
  await p.request.post(B + `/api/trips/${trip}/items`, { headers: h, data: { type: 'excursion', title: 'Altstadt', startLocal: '2027-05-11T09:00', endLocal: '2027-05-11T17:10', cruiseDayId: cruise.days[1].id } });
  await p.goto(B + '/');
  await p.fill('input[autocomplete=username]', 'philip'); await p.fill('input[type=password]', 'bordbuch123'); await p.click('button.btn-primary');
  await p.waitForSelector('.page-head');
  await p.goto(B + '/trips/' + trip);
  await p.waitForSelector('.trip-hero');
  console.log('Banner:', (await p.locator('.view-mode').innerText()).replace(/\n+/g, ' '), '| gesperrt:', await p.locator('.view-mode.locked').count());
  console.log('Hero-Knöpfe:', JSON.stringify(await p.locator('.hero-actions button').allInnerTexts()), '| FAB:', await p.locator('.fab').innerText());
  console.log('Chips/Leeren sichtbar:', await p.locator('.quick-add, .clear-btn').count());
  // Quittieren
  console.log('Puffer-Check:', (await p.locator('.checks-head').innerText()).replace(/\n+/g, ' '));
  await p.screenshot({ path: `${out}/190-gesperrt.png` });
  await p.click('.check-item button:has-text("quittieren")');
  await p.waitForSelector('.checks.all-acked');
  console.log('Nach Quittieren:', (await p.locator('.checks-head').innerText()).replace(/\n+/g, ' '), '| Inline-Warnung am Eintrag:', await p.locator('.entry .inline-warn').count());
  await p.click('.acked-toggle');
  console.log('Quittiert-Liste:', (await p.locator('.acked-list').innerText()).replace(/\n+/g, ' ').slice(0, 200));
  await p.screenshot({ path: `${out}/191-quittiert.png` });
  await p.click('.acked-list button:has-text("zurücknehmen")');
  await p.waitForSelector('.checks:not(.all-acked)');
  // Eintrag öffnen = nur lesen, Port-Karte mit Nummer
  await p.click('.port-card:has-text("Neapel")');
  console.log('Tag-Dialog Titel:', await p.locator('.modal-head h2').innerText(), '| Felder gesperrt:', await p.locator('fieldset[disabled]').count(), '| Anrufen-Link:', await p.locator('a:has-text("Anrufen")').count());
  await p.screenshot({ path: `${out}/192-tag-lesend.png` });
  await p.click('button:has-text("Ändern …")');
  await p.waitForSelector('.modal:has-text("Die Reise läuft bereits")');
  await p.screenshot({ path: `${out}/193-hinweis.png` });
  console.log('Prüfen bleibt:', await p.locator('.hero-actions button:has-text("Prüfen")').count());
  await p.click('button:has-text("Ansichtsmodus verlassen")');
  await p.waitForSelector('.view-mode:not(.locked)');
  console.log('Nach Verlassen:', (await p.locator('.view-mode').innerText()).replace(/\n+/g, ' '), '| FAB:', await p.locator('.fab').innerText());
  await p.reload(); await p.waitForSelector('.trip-hero');
  console.log('Nach Neuladen (gleiche Sitzung) gesperrt:', await p.locator('.view-mode.locked').count());
  console.log('scroll:', await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]), 'errors:', JSON.stringify(errors));
  await b.close();
})();
