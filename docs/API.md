# Bordbuch REST-API

Basis-URL: `http://<server>:8080/api` · JSON · Feldnamen in camelCase.
Die Web-App und die geplante iOS-App nutzen ausschließlich diese API.

## Authentifizierung

Alle Endpunkte außer `GET /health`, `GET|POST /setup` und `POST /auth/login` erwarten:

```
Authorization: Bearer <token>
```

Tokens laufen nicht ab. Sie werden bei `POST /auth/logout` oder einem Passwortwechsel ungültig.
Pro Gerät ein Token (`deviceName` beim Login).

Fehler: `{"error": "Meldung", "issues": [{"path": "startLocal", "message": "…"}]}` mit passendem
HTTP-Status (400 Validierung, 401 nicht angemeldet, 403 keine Berechtigung, 404, 409 Konflikt, 413 Datei zu groß).

## Zeiten & Zeitzonen

- Zeitpunkte von Einträgen sind **lokale Zeit + IANA-Zeitzone**: `startLocal: "2027-05-08T09:40"`,
  `startTz: "Europe/Zurich"`. Nur ein Datum ist ebenfalls erlaubt: `"2027-05-08"`.
- Fehlt die Zeitzone, gilt die Zeitzone des verknüpften Kreuzfahrt-Tages, sonst `DEFAULT_TZ` des Servers.
- Hafenzeiten (`arrival`, `departure`, `allAboard`) sind `HH:MM` in der `timezone` des Tages.

## Endpunkte

### System & Konto
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/health` | `{ok, version}` |
| GET | `/setup` | `{needsSetup}`: true, solange kein Benutzer existiert |
| POST | `/setup` | `{username, displayName, password}` → `{user, token}` (erstes Admin-Konto) |
| POST | `/auth/login` | `{username, password, deviceName?}` → `{user, token}` |
| POST | `/auth/logout` | aktuelles Token löschen |
| GET | `/me` | aktueller Benutzer |
| PATCH | `/me` | `{displayName?, currentPassword?, newPassword?}` |
| GET | `/users` | alle Familienmitglieder (für das Teilen) |
| POST | `/users` | *Admin:* `{username, displayName, password, isAdmin?}` |
| POST | `/users/:id/password` | *Admin:* `{password}` |
| DELETE | `/users/:id` | *Admin:* Reisen, die nur diesem Benutzer gehören, gehen an den Admin über |

### Reisen
| Methode | Pfad | Rolle | Beschreibung |
|---|---|---|---|
| GET | `/trips` | – | eigene Reisen inkl. `role`, `effectiveStartDate/EndDate`, `ships[]`, `memberCount`, `updatedAt` |
| POST | `/trips` | – | `{title, startDate?, endDate?, notes?, color?}` → `TripDetail` |
| GET | `/trips/:id` | viewer | `TripDetail` = `{trip, role, members[], cruises[] (inkl. days[]), items[], attachments[]}` |
| PATCH | `/trips/:id` | editor | Teil-Update |
| DELETE | `/trips/:id` | owner | inkl. Dokumente |
| GET | `/trips/:id/timeline` | viewer | Phasen + Puffer-Warnungen (siehe unten) |
| PUT | `/trips/:id/members/:userId` | owner | `{role: owner\|editor\|viewer}`, fügt hinzu oder ändert |
| DELETE | `/trips/:id/members/:userId` | owner / selbst | entfernen bzw. Reise verlassen |

**Sync:** `trip.updatedAt` ändert sich bei jeder Änderung an der Reise, ihren Einträgen,
Kreuzfahrten, Dokumenten oder Mitgliedern. Clients vergleichen `GET /trips` mit ihrem Cache und
laden nur geänderte Reisen neu.

### Kreuzfahrten
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/trips/:id/cruises` | `{shipName, cruiseLine?, cabin?, bookingRef?, notes?, days?: CruiseDay[]}` |
| PATCH | `/cruises/:id` | Teil-Update der Schiffsdaten |
| DELETE | `/cruises/:id` | inkl. Tage; Einträge bleiben erhalten, die Verknüpfung wird entfernt |
| POST | `/cruises/:id/days` | Tag hinzufügen |
| PATCH | `/cruise-days/:id` | Tag ändern |
| DELETE | `/cruise-days/:id` | Tag löschen |

`CruiseDay`: `{date, kind: embarkation|port|sea|disembarkation, portName?, country?, timezone?, arrival?, departure?, allAboard?, tender, notes?}`
Bei `disembarkation` bedeutet `departure` „von Bord bis“.

### Einträge
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/trips/:id/items` | neuer Eintrag |
| PATCH | `/items/:id` | Teil-Update (wird mit dem bestehenden Eintrag zusammengeführt und komplett validiert) |
| DELETE | `/items/:id` | inkl. angehängter Dokumente |

`Item`:
```json
{
  "type": "flight | train | bus | ferry | transfer | car_rental | parking | hotel | activity | excursion | restaurant | note",
  "title": "Zürich → Rom",
  "startLocal": "2027-05-08T09:40", "startTz": "Europe/Zurich",
  "endLocal": "2027-05-08T11:15",   "endTz": "Europe/Rome",
  "location": null, "confirmation": "K7XQ2P", "provider": "SWISS",
  "cost": 189.0, "currency": "CHF", "notes": null,
  "cruiseDayId": null,
  "details": { "flightNumber": "LX 1726", "from": "ZRH", "to": "FCO", "seat": "12A" }
}
```
Übliche `details`: Flug `airline, flightNumber, from, to, terminal, seat` · Zug `trainNumber, from, to, seat` ·
Transfer `mode, from, to, phone` · Hotel `room, phone, breakfast` · Parkplatz `lot, plate, shuttle` (Beginn = Einfahrt, Ende = Ausfahrt) · Ausflug `bookedVia: "ship"|"private", meetingPoint`.

### Dokumente
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/trips/:id/attachments?itemId=` | `multipart/form-data` mit Feld `file` |
| GET | `/attachments/:id[?download=1]` | Datei (inline bzw. als Download) |
| PATCH | `/attachments/:id` | `{filename?, itemId?}` |
| DELETE | `/attachments/:id` | |

## Timeline

`GET /trips/:id/timeline`
```json
{
  "tripId": "…", "updatedAt": "…", "defaultTimezone": "Europe/Zurich",
  "phases": [
    { "kind": "pre", "title": "Anreise", "cruiseId": null, "startDate": "2027-05-08", "endDate": "2027-05-10",
      "days": [ { "date": "2027-05-08", "cruiseDay": null,
                  "entries": [ { "itemId": "…", "role": "start", "time": "09:40", "timezone": "Europe/Zurich", "item": { … } } ] } ] },
    { "kind": "cruise", "title": "Kreuzfahrt · MS Aurora", "cruiseId": "…", "days": [ { "date": "…", "cruiseDay": { … }, "entries": [] } ] },
    { "kind": "post", "title": "Abreise", … }
  ],
  "warnings": [
    { "level": "warning", "code": "excursion_tight", "message": "Nur 15 min …", "itemId": "…", "cruiseDayId": "…" }
  ]
}
```

- `kind`: `trip` (keine Kreuzfahrt), `pre` (Anreise), `cruise`, `between`, `post` (Abreise). Bei vorhandener Kreuzfahrt sind `pre` und `post` immer enthalten, auch ohne Einträge.
- `role: "end"` = zweiter Auftritt eines mehrtägigen Eintrags (Hotel-Check-out, Mietwagen-Rückgabe, Parkplatz-Ausfahrt)
- Kreuzfahrt-Phasen enthalten jeden Tag der Route, auch Seetage ohne Einträge.

Warnungscodes:

| Code | Level | Bedeutung |
|---|---|---|
| `embark_missed` | error | Anreise kommt nach *Alle an Bord* an |
| `embark_tight` | warning | < 4 h (Flug) bzw. < 2 h (sonst) bis *Alle an Bord* |
| `embark_same_day` | info | Anreise per Flug am Einschiffungstag |
| `disembark_conflict` | error | Abreise startet vor Ankunft des Schiffs |
| `disembark_tight` | warning | < 3 h (Flug) bzw. < 1 h nach Ausschiffung |
| `parking_short` | warning | Parkplatz endet vor dem Ende der Rückreise |
| `excursion_late` | error | Ausflug endet nach *Alle an Bord* |
| `excursion_tight` | warning | Puffer < 30 min (privat: 60, Tender: +30) |
| `excursion_before_arrival` | warning | Beginn vor Ankunft des Schiffs |
| `excursion_no_end` | info | keine Endzeit angegeben |
| `excursion_unlinked` | info | Ausflug während der Kreuzfahrt ohne zugeordneten Hafentag |
| `excursion_sea_day` | warning | Ausflug einem Seetag zugeordnet |
