// Entwicklungs-Testserver: die echte App mit einer FAKE-KI (feste Antworten nach Dateiname) und leerer Datenbank in /tmp.
// So lassen sich KI-Abläufe (Auslesen, Recherche, Prüfen) im Browser testen, ohne API-Schlüssel und ohne Kosten.
// Start (Web vorher bauen: npm run build):  node --experimental-strip-types scripts/dev/fake-server.ts
// Dateinamen steuern die Antwort: kreuzfahrt*.pdf, flug*.pdf, Screenshot*/Eingef* (Hotel), sonst Landausflug.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../server/src/app.ts';
import type { Extractor } from '../../server/src/ai/types.ts';

const base = { suggestedTripTitle: null, warnings: [] as string[], cruise: null as any };
const item = (p: any) => ({ infos: [], startTz: null, endLocal: null, endTz: null, location: null, confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details: [], confidence: 'high', ...p });
const day = (p: any) => ({ infos: [], country: null, timezone: 'Europe/Rome', arrival: null, departure: null, allAboard: null, tender: false, notes: null, portName: null, ...p });
const extractor: Extractor = {
  model: 'fake-model',
  async extract({ files }) {
    const filename = files[0]!.filename;
    await new Promise((r) => setTimeout(r, 400));
    if (filename.startsWith('kreuzfahrt'))
      return { ...base, suggestedTripTitle: 'Mittelmeer mit MS Aurora, Mai 2027', documentKind: 'Kreuzfahrt-Buchung', summary: 'MS Aurora, 10. bis 13. Mai', items: [],
        cruise: { shipName: 'MS Aurora', cruiseLine: 'Beispiel-Reederei', cabin: '8142', bookingRef: 'AUR-4711', notes: null, infos: [], days: [
          day({ date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia', country: 'Italien', arrival: '12:00', allAboard: '17:30', departure: '18:00' }),
          day({ date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', arrival: '07:00', allAboard: '16:30', departure: '17:00' }),
          day({ date: '2027-05-12', kind: 'sea' }),
          day({ date: '2027-05-13', kind: 'disembarkation', portName: 'Barcelona', country: 'Spanien', timezone: 'Europe/Madrid', arrival: '06:00', departure: '09:30' }),
        ] } } as any;
    if (filename.startsWith('flug'))
      return { ...base, documentKind: 'Flugbuchung', summary: 'Zürich → Rom', items: [item({ type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', confirmation: 'K7XQ2P', details: [{ key: 'flightNumber', value: 'LX 1726' }, { key: 'from', value: 'ZRH' }, { key: 'to', value: 'FCO' }] })] } as any;
    if (filename.startsWith('Screenshot') || filename.startsWith('Eingef'))
      return { ...base, documentKind: 'Hotelbuchung', summary: `${files.length} Datei${files.length > 1 ? 'en' : ''} gelesen`, items: [item({ type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', location: 'Via Nazionale 22, Rom', confirmation: 'AB12345',
        infos: [{ label: 'Rezeption', value: '+39 06 1234 567', kind: 'phone', source: 'document' }, { label: 'Notruf Italien', value: '112 (Polizei, Rettung, Feuerwehr)', kind: 'emergency', source: 'ai' }] })] } as any;
    return { ...base, documentKind: 'Landausflug', summary: 'Pompeji', items: [item({ type: 'excursion', title: 'Pompeji & Vesuv', startLocal: '2027-05-11T08:00', endLocal: '2027-05-11T15:30', details: [{ key: 'bookedVia', value: 'ship' }] })] } as any;
  },
  async research({ mode, url }: any) {
    await new Promise((r) => setTimeout(r, 2500));
    const diagnostics = { queries: ['MS Aurora Reiseverlauf Mai 2027', 'MS Aurora Civitavecchia Barcelona Fahrplan'], fetched: url ? [url] : [], sourcesFound: 3, droppedNoSource: 1, droppedInvalid: 0, notes: 'Laut der Seite der Reederei startet die Reise am 10. Mai in Civitavecchia ...' };
    if (mode === 'route' && url) {
      const src = [{ title: 'Reederei', url }];
      const d = (date: string, kind: string, portName: string | null, country: string | null, arrival: string | null, departure: string | null) => ({ date, kind, portName, country, timezone: null, arrival, departure, allAboard: null, tender: false });
      return { summary: 'Reiseverlauf auf der Seite der Reederei gefunden (4 Tage).', searches: 2, diagnostics, suggestions: [{ target: { kind: 'cruise', index: 0 }, title: 'Reiseverlauf (4 Tage)', fields: [], details: [], infos: [], note: null, sources: src,
        route: { shipName: 'MS Aurora', cruiseLine: 'Beispiel-Reederei', days: [d('2027-05-10', 'embarkation', 'Civitavecchia', 'Italien', '12:00', '18:00'), d('2027-05-11', 'port', 'Neapel', 'Italien', '07:00', '17:00'), d('2027-05-12', 'sea', null, null, null, null), d('2027-05-13', 'disembarkation', 'Barcelona', 'Spanien', '06:00', null)] } }] };
    }
    return { summary: 'Die Suche lieferte keine prüfbaren Quellen.', searches: 3, diagnostics: { ...diagnostics, sourcesFound: 0, droppedNoSource: 2 }, suggestions: [] };
  },
  async review({ outline }: any) {
    await new Promise((r) => setTimeout(r, 2500));
    const item = outline.match(/item (\S+):/)?.[1];
    const dayId = outline.match(/day (\S+):/)?.[1];
    return { summary: 'Die Reise wirkt bis auf die Rückreise schlüssig. Zwischen Flug und Einschiffung fehlt ein Transfer.', findings: [
      { severity: 'hint', title: 'Hotel-Nacht vor der Einschiffung prüfen', text: 'Der Flug landet am 9. Mai um 11:15, die Einschiffung ist am 10. Mai. Es gibt keine Übernachtung dazwischen.', itemIds: item ? [item] : [], dayIds: [], suggestion: null },
      { severity: 'error', title: 'Keine Rückreise nach der Ausschiffung', text: 'Die Kreuzfahrt endet am 13. Mai in Barcelona. Danach gibt es keinen Flug oder Zug nach Hause.', itemIds: [], dayIds: dayId ? [dayId] : [], suggestion: 'Rückflug ab Barcelona anlegen.' },
      { severity: 'warning', title: 'Kein Transfer zwischen Flughafen Rom und Hafen Civitavecchia', text: 'Zwischen Landung und Einschiffung ist keine Verbindung eingetragen.', itemIds: [], dayIds: [], suggestion: 'Transfer oder Zug eintragen.' },
    ] };
  },
  async check() {},
};
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-fake-'));
const app = await buildApp({ dataDir, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)), defaultTz: 'Europe/Zurich', maxUploadMb: 25, anthropicApiKey: null, aiModel: 'fake' }, { extractor });
const port = Number(process.env.PORT ?? 8091);
await app.listen({ port, host: '127.0.0.1' });
console.log(`fake server on ${port}`);
