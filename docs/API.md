# Reisebuch REST-API

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

### Persönliche Einstellungen

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/me/settings` | `{pace: {enabled, factor, extraMinutes}}` des angemeldeten Benutzers |
| PATCH | `/me/settings` | Teil-Update, z. B. `{pace: {enabled: true, factor: 1.5}}`. `factor` 1 bis 4, `extraMinutes` 0 bis 120 |

`pace` (persönlicher Zeitbedarf): Jede empfohlene Mindestzeit des Puffer-Checks wird mit `factor` multipliziert, um `extraMinutes` verlängert und auf 5 Minuten aufgerundet. Die Einstellung gilt pro Benutzer; die Timeline des jeweiligen Aufrufers enthält `pace` (oder `null`).

### HTTPS-Zertifikat für das iPhone

| Methode | Pfad | Rolle | Beschreibung |
|---|---|---|---|
| GET | `/certificate/info` | angemeldet | `{present, subject, validFrom, validTo, daysLeft, altNames[], fingerprint}` |
| GET | `/certificate` | **öffentlich** | Zertifikat als `bordbuch.crt` (DER, `application/x-x509-ca-cert`, iOS bietet die Installation an); `?format=pem` liefert PEM |
| PUT | `/certificate` | Admin | `{pem}`. Nur ein Zertifikat; privater Schlüssel, Unlesbares und Abgelaufenes werden abgelehnt (400) |
| DELETE | `/certificate` | Admin | entfernt das Zertifikat aus Reisebuch (Syno und Geräte bleiben unberührt) |

Der Download ist öffentlich, weil Safari einen Link ohne das Token der App öffnet. Es ist ein öffentliches Zertifikat.

### Benachrichtigungen (Web Push)

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/push/key` | `{publicKey}`, der öffentliche VAPID-Schlüssel für `pushManager.subscribe` |
| POST | `/push/subscribe` | `{endpoint, keys: {p256dh, auth}, deviceName?}`. Nur Endpunkte von Apple, Google, Mozilla und Microsoft (HTTPS) werden akzeptiert; ein Gerät gehört genau einem Benutzer |
| DELETE | `/push/subscribe` | `{endpoint}`, meldet ein eigenes Gerät ab |
| GET | `/push/status` | angemeldete Geräte des Benutzers |
| POST | `/push/test` | Testnachricht an alle eigenen Geräte, Antwort `{results: [{deviceName, ok, error}]}` |

Einstellungen unter `GET|PATCH /me/settings` → `notifications`: `enabled`, `boarding`/`boardingLead` (Minuten, Standard 60), `excursion`/`excursionLead` (45),
`transport`/`transportLead` (90), `flightLead` (180). Der Server prüft alle 30 Sekunden, welche Erinnerungen fällig sind, und sendet sie einmal
je Ereignis (Tabelle `push_log`). Fällig heißt: Zeitpunkt = Ereignis minus Vorlauf, höchstens 5 Minuten zurück und das Ereignis liegt noch
in der Zukunft. Der Vorlauf ist der eingestellte, verlängert um den persönlichen Zeitbedarf (`pace`). Nachrichtenform:
`{title, body, url, tag}`; `url` öffnet die Reise.

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
| POST | `/trips` | – | `{title, kind?, startDate?, endDate?, notes?, color?}` → `TripDetail`. `kind`: `cruise` (Standard), `city` (Städtetrip/Urlaub) oder `roundtrip` (Rundreise). Mit `PATCH /trips/:id` änderbar. Das Anlegen einer Kreuzfahrt setzt `kind` auf `cruise`; zwei Stationen aus einem Dokument machen aus `city` eine `roundtrip` |
| GET | `/trips/:id` | viewer | `TripDetail` = `{trip, role, members[], cruises[] (inkl. days[]), items[], attachments[]}` |
| PATCH | `/trips/:id` | editor | Teil-Update |
| DELETE | `/trips/:id` | owner | inkl. Dokumente |
| GET | `/trips/:id/timeline` | viewer | Phasen + Puffer-Warnungen (siehe unten) |
| GET | `/trips/:id/costs` | viewer | Kostenübersicht (siehe „Kosten“ unten) |
| PUT | `/trips/:id/members/:userId` | owner | `{role: owner\|editor\|viewer}`, fügt hinzu oder ändert |
| DELETE | `/trips/:id/members/:userId` | owner / selbst | entfernen bzw. Reise verlassen |

**Sync:** `trip.updatedAt` ändert sich bei jeder Änderung an der Reise, ihren Einträgen,
Kreuzfahrten, Dokumenten oder Mitgliedern. Clients vergleichen `GET /trips` mit ihrem Cache und
laden nur geänderte Reisen neu.

### Kreuzfahrten
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/trips/:id/cruises` | `{shipName, cruiseLine?, cabin?, bookingRef?, notes?, cost?, currency?, paymentStatus?, paidAmount?, dueDate?, days?: CruiseDay[]}` (Preis und Zahlung wie bei Einträgen, siehe „Kosten“) |
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
| POST | `/trips/:id/items/delete` | `{ids: string[]}` löscht mehrere Einträge (z. B. einen ganzen Abschnitt) in einer Transaktion; 204 |

`Item`:
```json
{
  "type": "flight | train | bus | ferry | transfer | car_rental | parking | hotel | stop | activity | excursion | restaurant | note",
  "title": "Zürich → Rom",
  "startLocal": "2027-05-08T09:40", "startTz": "Europe/Zurich",
  "endLocal": "2027-05-08T11:15",   "endTz": "Europe/Rome",
  "location": null, "confirmation": "K7XQ2P", "provider": "SWISS",
  "cost": 189.0, "currency": "CHF",
  "paymentStatus": "deposit", "paidAmount": 50.0, "dueDate": "2027-04-01",
  "notes": null,
  "cruiseDayId": null,
  "details": { "flightNumber": "LX 1726", "from": "ZRH", "to": "FCO", "seat": "12A" }
}
```
`infos` (Eintrag, Kreuzfahrt-Tag und Kreuzfahrt): Liste `{label, value, kind: phone|emergency|email|link|text, source: user|document|ai}`, höchstens 30. `source: "ai"` markiert Angaben aus dem allgemeinen Wissen der KI (z. B. Notrufnummer eines Landes), die der Nutzer prüfen soll. Beim Aktualisieren aus einem Dokument werden Infos zusammengeführt, gleiche Bezeichnung mit gleicher Nummer wird nicht doppelt angelegt.

Übliche `details`: Flug `airline, flightNumber, from, to, terminal, seat` · Zug `trainNumber, from, to, seat` ·
Transfer `mode, from, to, phone` · Hotel `room, phone, breakfast` · Parkplatz `lot, plate, shuttle` (Beginn = Einfahrt, Ende = Ausfahrt) · Ausflug `bookedVia: "ship"|"private", meetingPoint`.

### Dokumente
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/trips/:id/attachments?itemId=` | `multipart/form-data` mit Feld `file` |
| GET | `/attachments/:id[?download=1]` | Datei (inline bzw. als Download) |
| PATCH | `/attachments/:id` | `{filename?, itemId?}` |
| DELETE | `/attachments/:id` | |

### Dokument-Analyse (KI)

Setzt `ANTHROPIC_API_KEY` auf dem Server voraus. `GET /ai/status` zeigt, ob sie aktiv ist.

| Methode | Pfad | Rolle | Beschreibung |
|---|---|---|---|
| GET | `/ai/status` | – | `{enabled, model}` |
| POST | `/ai/check` | Admin | Testanfrage an die Claude-API; 502 mit Klartext bei Schlüssel-/Netzwerkproblem |
| POST | `/trips/:id/documents?itemId=` | editor | `multipart/form-data` (Feld `file`), speichert und analysiert. Antwort: `{attachment, aiEnabled, analyzable}`; die Anfrage dauert bis zum Ende der Analyse (bis ca. 1 Minute) |
| POST | `/trips/:id/documents/group` | editor | `{attachmentIds: [2..10]}` bereits hochgeladener Dateien (über `POST /trips/:id/attachments`) als **eine** Unterlage auswerten. Die erste ID führt: sie trägt die Vorschläge, die übrigen haben `analysisStatus: "grouped"`, folgen beim Übernehmen oder Verwerfen und erscheinen nicht im Posteingang. Antwort `{attachment, memberIds}` |
| POST | `/attachments/:id/analyze` | editor | Analyse erneut starten (bei einer Gruppe weiterhin mit allen Dateien) |
| GET | `/attachments/:id/analysis` | viewer | Vorschläge: `{status, attachment, documentKind, summary, warnings, items[], cruise, research}` |
| GET | `/attachments/:id/research` | viewer | Stand der optionalen Web-Recherche: `{research: null | {status: pending/done/failed, summary, suggestions[], error}}` |
| POST | `/attachments/:id/research` | editor | Startet die Recherche im Hintergrund (202). Body optional: `{mode: "gaps"\|"route", url?}`. `gaps` sucht Lücken (Routen, Zeiten, Telefonnummern), `route` den Reiseverlauf der Kreuzfahrt (Vorschlag mit `route.days[]`). `url` ist eine Seite, die die KI zuerst liest (nur http/https). Ergebnisse stehen mit Quellen in `suggestions[]`, `diagnostics` zeigt Suchanfragen, gelesene Seiten und verworfene Funde. Nichts wird ohne Annahme übernommen. Zum Abfragen `GET` wiederholen |
| POST | `/attachments/:id/research/accept` | editor | `{ids: [...]}` übernimmt Vorschläge in die Analyse (füllt nur Lücken, Infos mit `source: "web"`, Quelle in den Notizen). Danach ganz normal `apply` |
| POST | `/attachments/:id/research/dismiss` | editor | Verwirft die Recherche |
| POST | `/attachments/:id/apply` | editor | Vorschläge übernehmen (siehe unten), alles in einer Transaktion |
| POST | `/attachments/:id/dismiss` | editor | Dokument ohne Übernahme behalten |

`Attachment.analysisStatus`: `null` (nie analysiert) · `pending` · `grouped` (Teil einer gemeinsamen Auswertung) · `done` (Vorschläge warten) · `failed` (`analysisError` nennt den Grund) · `applied` · `dismissed`.

`suggestedTripTitle` (oder `null`) ist ein Vorschlag für den Reisenamen, den die Web-App beim Start einer Reise aus Dokumenten übernimmt.

`files[]` nennt die gelesenen Dateien `{id, filename}`; mehr als eine, wenn sie zusammen ausgewertet wurden.

`items[]` der Analyse: `{index, data, confidence: high|medium|low, match: {itemId, title, reason, changes[]} | null, problems[]}`.
`match` verweist auf einen vorhandenen Eintrag derselben Buchung. `cruise`: `{data, match, newDays, updatedDays, problems[]}`.

`POST /attachments/:id/apply`:
```json
{
  "items": [
    { "action": "create", "data": { "type": "hotel", "title": "…", "startLocal": "2027-05-08T14:00", "…": "…" } },
    { "action": "update", "itemId": "<id aus match>", "data": { "startLocal": "2027-05-08T15:00" } },
    { "action": "skip", "data": {} }
  ],
  "cruise": { "action": "create | update | skip", "cruiseId": "<bei update>", "data": { "shipName": "…", "days": [ … ] } }
}
```
`create` validiert wie `POST /trips/:id/items`. `update` führt `data` in den vorhandenen Eintrag ein (vorhandener Titel und
Notizen bleiben, neue Angaben ersetzen leere oder abweichende Felder, `details` werden zusammengeführt). Die Kreuzfahrt wird
zuerst verarbeitet. Schlägt ein Teil fehl, wird nichts gespeichert. Das Dokument wird am ersten angelegten oder aktualisierten
Eintrag abgelegt. Nach jedem Übernehmen werden Landausflüge ohne Hafentag dem einzigen Hafentag ihres Datums zugeordnet, damit die
Reihenfolge der Dokumente keine Rolle spielt.

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
    { "level": "warning", "code": "excursion_tight", "message": "Nur 15 min …", "itemId": "…", "cruiseDayId": "…", "role": "start" }
  ]
}
```

- `pace`: persönlicher Zeitbedarf des Aufrufers oder `null`. Die Texte in `warnings` nennen dann beide Zeiten („30 min normal, 45 min persönlich“); `personal: true` heißt, dass es normal reicht und nur mit dem persönlichen Zeitbedarf zu knapp ist.
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
| `hotel_checkout_late` | error | Hotel-Check-out am Einschiffungstag liegt nach *Alle an Bord* (Warnung gehört zum Check-out, `role: "end"`) |
| `hotel_embark_tight` | warning | < 2 h zwischen Check-out und *Alle an Bord* (`role: "end"`) |
| `hotel_wait_boarding` | info | > 3 h zwischen Check-out und Öffnung des Check-ins am Schiff (`role: "end"`) |
| `hotel_checkin_wait` | info | > 3 h zwischen Ausschiffung und Hotel-Check-in |
| `hotel_overlaps_cruise` | warning | Hotelbuchung überschneidet sich mit der Kreuzfahrt um mehr als 12 h (also mindestens eine Nacht) |
| `hotel_late_arrival` | info | Ankunft am Hotel nach 22:00 |
| `hotel_early_arrival` | info | Ankunft > 4 h vor dem Check-in |
| `parking_short` | warning | Parkplatz endet vor dem Ende der Rückreise |
| `stop_no_lodging` | warning | Für Nächte einer Station (Typ `stop`) ist keine Unterkunft eingetragen (Hotel oder Kreuzfahrt) |
| `stop_no_transport` | info | Zwischen zwei aufeinanderfolgenden Stationen ist keine Verbindung eingetragen (Flug, Zug, Bus, Fähre, Transfer, Mietwagen) |
| `stop_overlap` | warning | Zwei Stationen überschneiden sich um mehr als 12 h |
| `excursion_late` | error | Ausflug endet nach *Alle an Bord* |
| `excursion_tight` | warning | Puffer < 30 min (privat: 60, Tender: +30) |
| `excursion_before_arrival` | warning | Beginn vor Ankunft des Schiffs |
| `excursion_no_end` | info | keine Endzeit angegeben |
| `excursion_unlinked` | info | Ausflug während der Kreuzfahrt ohne zugeordneten Hafentag |
| `excursion_sea_day` | warning | Ausflug einem Seetag zugeordnet |

### KI-Prüfung der ganzen Reise

Nur lesend: die KI sieht alle Einträge und Kreuzfahrt-Tage zusammen und meldet Lücken und Widersprüche. Gesendet werden Titel, Zeiten, Orte, Anbieter und kurze Notizen, keine Buchungsnummern, Preise, Telefonnummern oder Dokumente. Läuft im Hintergrund.

| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| GET | `/trips/:id/review` | viewer | `{review: null \| {status: pending/done/failed, summary, findings[], error, finishedAt}, stale}`. `stale` ist wahr, wenn die Reise seit der Prüfung geändert wurde |
| POST | `/trips/:id/review` | editor | Startet die Prüfung (202). Zum Abfragen `GET` wiederholen. 400 bei leerer Reise, 409 ohne API-Schlüssel oder wenn sie schon läuft |

`findings[]`: `{severity: error/warning/hint, title, text, itemIds[], dayIds[], suggestion}`. `/ai/status` meldet zusätzlich `review: true/false`.

### Stationen

Eine Station ist ein Eintrag vom Typ `stop`: `title` ist der Ort, `startLocal` die Ankunft, `endLocal` die Abreise, `startTz` die Zeitzone, `details.country` das Land. Sie erscheint in der Zeitleiste mit Ankunft und Abreise und wird wie Hotels als mehrtägiger Eintrag behandelt.

### Hinweise quittieren

Hinweise des Puffer-Checks lassen sich quittieren („gesehen, ist in Ordnung“). Das gilt für alle Mitglieder der Reise und ändert nichts am Plan (kein neuer `updatedAt`).

| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| GET | `/trips/:id/timeline` | viewer | Jede Warnung hat zusätzlich `key` (Hash aus Code, Eintrag und Text) und `ack: null` oder `{by, at}` |
| PUT | `/trips/:id/warnings/:key/ack` | editor | Quittiert den Hinweis. 404, wenn er nicht mehr aktuell ist |
| DELETE | `/trips/:id/warnings/:key/ack` | editor | Nimmt die Quittierung zurück |

Ändert sich die Lage (andere Zeiten, anderer Eintrag), ändert sich der Text und damit der `key`: der Hinweis kommt unquittiert zurück.

### Terminal, Gate, Schalter, Kofferband, Gleis

Diese Angaben stehen in `details` des Eintrags: Flug `terminal`, `checkinDesk` (Check-in-Schalter), `gate`, `baggageBelt` (Kofferband bei Ankunft); Zug `platform` (Gleis); Mietwagen `desk` (Schalter). Sie sind oft erst kurz vorher bekannt und werden im Ablauf hervorgehoben, im Abflug-Erinnerung genannt (ohne Kofferband) und von der KI nur gelesen, wenn sie im Dokument stehen.

Ändert ein Bearbeiter eine dieser Angaben über `PATCH /items/:id` und liegt der Termin höchstens 36 Stunden voraus (oder weniger als 8 Stunden zurück), bekommen die **anderen** Mitglieder der Reise eine Push-Nachricht („Gate B12 (vorher B14)“). Pro Person abschaltbar mit `notifications.infoChange` in `/me/settings` (Standard an).

**Reisetag-Abfrage** (KI mit Websuche, optional; `GET /ai/status` meldet `placeLookup: true`):

| Methode | Pfad | Rolle | Beschreibung |
|---|---|---|---|
| POST | `/items/:id/place-lookup` | editor | Startet die Suche für diesen Flug, Zug oder Mietwagen. 202 mit `{lookup}` (Status `pending`). 400 bei anderen Eintragsarten, 409 ohne KI oder wenn schon eine Suche läuft |
| GET | `/items/:id/place-lookup` | viewer | `{lookup: null \| {status: pending\|done\|failed, startedAt, finishedAt?, error?, summary?, searches?, queries?, findings[]}}` |

`findings[]`: `{key, label, value, current, source: {title, url}, note}`. `key` ist eines der Felder oben, `current` der aktuell eingetragene Wert.
Die Suche sieht nur Flug- bzw. Zugnummer, Airline, Von/Nach, Datum und die bisherigen Ortsangaben, keine Buchungsnummer und keinen Sitzplatz. Sie
nimmt nur Werte von Seiten für genau diesen Termin, jeder Fund hat eine Quelle aus der Suche. Gespeichert wird nichts: Der Client übernimmt
die gewählten Werte mit `PATCH /items/:id` (`details`), das löst wie oben den Push an die anderen aus. Das Ergebnis liegt nur im Speicher des Servers.

### Kosten

Preis und Zahlung gibt es an Einträgen und an der Kreuzfahrt (Gesamtpreis der Buchung), mit denselben Feldern:

| Feld | Bedeutung |
|---|---|
| `cost` | Betrag oder `null` |
| `currency` | 3-stelliger Code (`EUR`, `CHF` …) oder `null`. Es wird nie eine Währung angenommen |
| `paymentStatus` | `open`, `deposit` (angezahlt), `paid` oder `null` (keine Angabe, zählt als offen) |
| `paidAmount` | bereits angezahlt; nur bei `deposit`, sonst speichert der Server `null` |
| `dueDate` | `JJJJ-MM-TT`, bis wann der (Rest-)Betrag zu zahlen ist, oder `null` |

Die KI liest Preise aus Buchungsbestätigungen (`cost`, `currency` an Einträgen und an `cruise` im Vorschlag) und bei Einträgen auch den
Zahlungsstand (`paymentStatus`, `paidAmount`, `dueDate`), nur wenn das Dokument ihn ausdrücklich nennt. Den Zahlungsstand der Kreuzfahrt trägt
der Nutzer ein: Die Antwortstruktur der KI muss klein bleiben, die API lehnt sie sonst ab („compiled grammar is too large“). Beim Aktualisieren füllt ein Dokument nur Lücken:
einen eingetragenen Preis und einen eingetragenen Zahlungsstand ändert es nie.

`GET /trips/:id/costs` liefert die Übersicht, auf dem Server gerechnet:
```json
{
  "currencies": [{ "currency": "EUR", "total": 3900, "paid": 920, "open": 2980, "unstated": 0,
                   "groups": [{ "kind": "cruise", "count": 1, "total": 3480, "paid": 500, "open": 2980, "entryIds": ["…"] }] }],
  "withoutCurrency": [CostEntry],
  "missingPrice": [{ "kind": "flight", "count": 2, "entryIds": ["…"] }],
  "due": [CostEntry],
  "entries": [CostEntry]
}
```
`CostEntry`: `{id, source: item|cruise, kind, title, date, cost, currency, paymentStatus, paid, open, dueDate}`. `kind` ist der Eintragstyp oder
`cruise`. Währungen werden nie zusammengezählt oder umgerechnet; die größte Summe steht zuerst. Beträge ohne Währung stehen nur in
`withoutCurrency`. `missingPrice` nennt gebuchte Leistungen ohne Preis (Kreuzfahrt, Flug, Zug, Bus, Fähre, Transfer, Mietwagen, Parkplatz,
Übernachtung, Landausflug), nicht Aktivitäten, Restaurants, Stationen und Notizen. `due` enthält offene Beträge mit Fälligkeit, früheste zuerst.

