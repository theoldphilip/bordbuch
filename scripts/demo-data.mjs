// Legt eine Beispielreise an: node scripts/demo-data.mjs http://localhost:8080 <token>
const [base = 'http://localhost:8080', token] = process.argv.slice(2);
if (!token) {
  console.error('Aufruf: node scripts/demo-data.mjs <url> <token>');
  process.exit(1);
}
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const { trip } = await call('POST', '/api/trips', { title: 'Mittelmeer Mai 2027', color: '#1f7a8c' });
const t = trip.id;
const cruise = await call('POST', `/api/trips/${t}/cruises`, {
  shipName: 'MS Aurora', cruiseLine: 'Beispiel-Reederei', cabin: '8142 · Balkon', bookingRef: 'AUR-4711',
  days: [
    { date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia (Rom)', country: 'Italien', timezone: 'Europe/Rome', arrival: '12:00', allAboard: '17:30', departure: '18:00' },
    { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', timezone: 'Europe/Rome', arrival: '07:00', departure: '17:00', allAboard: '16:30' },
    { date: '2027-05-12', kind: 'port', portName: 'Valletta', country: 'Malta', timezone: 'Europe/Malta', arrival: '13:00', departure: '19:00', allAboard: '18:30' },
    { date: '2027-05-13', kind: 'sea' },
    { date: '2027-05-14', kind: 'port', portName: 'Palma', country: 'Spanien', timezone: 'Europe/Madrid', arrival: '08:00', departure: '17:00', allAboard: '16:30', tender: true },
    { date: '2027-05-15', kind: 'disembarkation', portName: 'Barcelona', country: 'Spanien', timezone: 'Europe/Madrid', arrival: '06:00', departure: '09:30' },
  ],
});
const day = (date) => cruise.days.find((d) => d.date === date).id;
const items = [
  { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-08T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-08T11:15', endTz: 'Europe/Rome', provider: 'SWISS', confirmation: 'K7XQ2P', details: { airline: 'SWISS', flightNumber: 'LX 1726', from: 'ZRH', to: 'FCO', seat: '12A' } },
  { type: 'parking', title: 'Parkhaus Flughafen Zürich P3', startLocal: '2027-05-08T07:30', startTz: 'Europe/Zurich', endLocal: '2027-05-17T18:00', endTz: 'Europe/Zurich', cost: 189, currency: 'CHF', confirmation: 'P3-7781', details: { lot: 'P3', plate: 'ZH 123456', shuttle: 'alle 15 min' } },
  { type: 'transfer', title: 'Taxi in die Stadt', startLocal: '2027-05-08T12:00', startTz: 'Europe/Rome', endLocal: '2027-05-08T12:45', details: { mode: 'Taxi', from: 'FCO', to: 'Hotel' } },
  { type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', location: 'Via Nazionale 22, Rom', confirmation: '88213', cost: 410, currency: 'EUR' },
  { type: 'activity', title: 'Vatikanische Museen', startLocal: '2027-05-09T09:00', startTz: 'Europe/Rome', endLocal: '2027-05-09T12:30', cost: 64, currency: 'EUR' },
  { type: 'transfer', title: 'Transfer zum Hafen', startLocal: '2027-05-10T11:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T12:30', details: { from: 'Hotel Artemide', to: 'Hafen Civitavecchia' } },
  { type: 'excursion', title: 'Pompeji & Vesuv', startLocal: '2027-05-11T08:00', endLocal: '2027-05-11T16:15', cruiseDayId: day('2027-05-11'), provider: 'Privatguide Marco', cost: 180, currency: 'EUR', details: { bookedVia: 'private', meetingPoint: 'Hafenausgang Molo Beverello' } },
  { type: 'excursion', title: 'Stadtrundgang Valletta', startLocal: '2027-05-12T14:00', endLocal: '2027-05-12T17:00', cruiseDayId: day('2027-05-12'), details: { bookedVia: 'ship', meetingPoint: 'Theater, Deck 5' } },
  { type: 'restaurant', title: 'Spezialitätenrestaurant', startLocal: '2027-05-13T19:30', cruiseDayId: day('2027-05-13') },
  { type: 'excursion', title: 'Kathedrale & Altstadt Palma', startLocal: '2027-05-14T09:00', endLocal: '2027-05-14T15:50', cruiseDayId: day('2027-05-14'), details: { bookedVia: 'ship' } },
  { type: 'hotel', title: 'Hotel Casa Fuster', startLocal: '2027-05-15T10:00', startTz: 'Europe/Madrid', endLocal: '2027-05-17T11:00', location: 'Passeig de Gràcia 132, Barcelona' },
  { type: 'activity', title: 'Sagrada Família', startLocal: '2027-05-16T10:00', startTz: 'Europe/Madrid', endLocal: '2027-05-16T12:00' },
  { type: 'transfer', title: 'Taxi zum Flughafen', startLocal: '2027-05-17T11:30', startTz: 'Europe/Madrid', endLocal: '2027-05-17T12:15', details: { mode: 'Taxi', from: 'Hotel Casa Fuster', to: 'Flughafen BCN' } },
  { type: 'flight', title: 'Barcelona → Zürich', startLocal: '2027-05-17T14:25', startTz: 'Europe/Madrid', endLocal: '2027-05-17T16:10', endTz: 'Europe/Zurich', confirmation: 'K7XQ2P', details: { airline: 'SWISS', flightNumber: 'LX 1953', from: 'BCN', to: 'ZRH' } },
];
for (const i of items) await call('POST', `/api/trips/${t}/items`, i);
console.log(`Beispielreise angelegt: ${base}/trips/${t}`);
