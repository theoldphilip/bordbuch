# AUFTRAG-0.2.0.md: Offline lesen, Jetzt-Markierung, Reisetag-Abfrage (iOS-Auftrag 2)

Version **0.2.0, Build 2** (Regel 2, alle Vorkommen). Philip hat 0.1.0 auf seinem iPhone installiert und mit echten Daten geprüft:
Anmeldung, Reiseliste, Ablauf, Hinweise, Gate/Schalter, „Alle an Bord“, Anrufen, Emojis und die Meldung ohne VPN sind in Ordnung.

Vorher: Trennungsprüfung aus `ios/CLAUDE.md`, `git pull --rebase origin main`. Geschrieben wird nur unter `ios/`.

---

## Teil A: Offline lesen

Unterwegs gibt es oft kein VPN (Schiff, Flugzeug, Ausland ohne Netz). Die App soll dann zeigen, was sie zuletzt geladen hat.

- **Zwischenspeicher:** Jede erfolgreiche Antwort von `GET /api/trips` und `GET /api/trips/:id/timeline` wird unverändert (die rohen
  JSON-Daten) mit Zeitpunkt gespeichert: Application Support, eigener Ordner `cache/`, eine Datei für die Liste, eine je Reise
  (`timeline-<tripId>.json`). Dateischutz `completeUntilFirstUserAuthentication`. Von der Sicherung ausnehmen (`isExcludedFromBackup`).
- **Laden:** Erst sofort den Zwischenspeicher zeigen (falls vorhanden), dann im Hintergrund vom Server laden und ersetzen. Gelingt das
  nicht (kein Netz, Zeitüberschreitung, Server nicht erreichbar), bleibt die gespeicherte Ansicht stehen.
- **Hinweis:** Zeigt die App gespeicherte Daten, steht oben ein ruhiges Band „Offline · Stand Fr., 27. Nov., 14:32“ (Zeitpunkt der
  gespeicherten Antwort, deutsch). Kein Rot, kein Fehlerdialog. Ohne gespeicherte Daten bleibt die bisherige Meldung „Ist das VPN an?“.
- **Vorladen:** Nach dem Laden der Reiseliste lädt die App im Hintergrund den Ablauf aller **laufenden und kommenden** Reisen (nicht der
  vergangenen), höchstens 5 gleichzeitig, damit sie offline da sind, ohne dass Philip jede einmal geöffnet haben muss. Fehler dabei still.
- **401** bleibt wie bisher: abmelden. **Abmelden löscht den ganzen Zwischenspeicher** (Daten der Familie gehören nach dem Abmelden nicht
  mehr aufs Gerät). Gelöschte Reisen (nicht mehr in der Liste) entfernen ihre Datei beim nächsten erfolgreichen Laden der Liste.
- Zeitzonen und „Jetzt“ (Teil B) rechnen mit den gespeicherten Daten genauso.
- Kein Bearbeiten offline. Die Reisetag-Abfrage (Teil C) braucht Netz; offline ist ihr Knopf ausgegraut mit „Nur mit Verbindung“.

## Teil B: Jetzt-Markierung im Ablauf

Wie in der Web-App: Während der Reise sind vergangene Einträge ausgegraut, und eine Markierung zeigt, wo ihr gerade seid.

Vorbild ist `web/src/pages/Trip.tsx` (`entryStart`, `entryEnd`, `dayEnd`, `firstStart`, die Berechnung von `nowKey` in `TimelineView` und
`NowMarker`) und `web/src/format.ts` (`localToInstant`). Regeln, genau so übernehmen:

- **Zeitpunkt aus Ortszeit:** `startLocal`/`endLocal` sind Ortszeit in der Zone des Auftritts (`entry.timezone`). Umrechnen mit
  `Calendar`/`TimeZone` der IANA-Zone. **Nur ein Datum** (`2027-05-08`) bedeutet für das Ende 23:59 dieses Tages, für den Beginn 00:00.
- **Ende eines Auftritts** (`entryEnd`): bei `role: "end"` das `endLocal` (sonst `startLocal`) in `entry.timezone`; bei Hotel, Mietwagen,
  Parkplatz und Station (`hotel`, `car_rental`, `parking`, `stop`) der eigene Zeitpunkt des Auftritts (Check-in bzw. Check-out); bei allen
  anderen Typen mit `endLocal` dessen Ende in `item.endTz ?? entry.timezone` (also die Landung, nicht der Abflug); sonst `startLocal`.
- **Ende eines Hafentags** (`dayEnd`): `departure` des Tages (außer Seetag) in `cruiseDay.timezone ?? defaultTimezone`, sonst das Tagesende.
- **Vergangen:** Ende vor jetzt → Eintrag bzw. Hafentag ausgegraut (deutlich blasser, Text weiter lesbar, weiter antippbar).
  Ein Tag, dessen Elemente alle vergangen sind, bekommt auch eine blassere Überschrift.
- **Markierung „Jetzt · 14:32“:** vor dem **ersten Element, das noch nicht vorbei ist** (Hafentag oder Eintrag in Reihenfolge), aber **nur, wenn
  mindestens ein Element schon vorbei ist** (also während der Reise; davor und danach keine Markierung). Uhrzeit in der Zeitzone dieses
  Elements. Auffällige, aber ruhige Farbe (die Web-App nutzt ein Rosa `#d6336c`), eine dünne Linie mit kleinem Etikett.
- **Aktualisierung:** jede Minute und sofort, wenn die App wieder in den Vordergrund kommt (`scenePhase`).
- Beim Öffnen einer laufenden Reise einmal zur Markierung scrollen (nicht bei jeder Aktualisierung).
- Unit-Tests: Umrechnung Ortszeit → Zeitpunkt (Sommerzeit-Wechsel, zwei Zonen bei einem Flug, nur Datum), Ende je Typ, Position der
  Markierung (vor der Reise keine, mittendrin richtig, nach der Reise keine).

## Teil C: Reisetag-Abfrage für Gate, Schalter, Kofferband, Gleis

Das gibt es seit Server 0.10.0 in der Web-App. In der App erscheint es in der Detailansicht von **Flug, Zug und Mietwagen**.

- **Nur anzeigen, wenn** `GET /api/ai/status` → `placeLookup: true` (beim Start der App einmal abfragen, Ergebnis merken; offline den
  letzten Wert) **und** die Rolle in dieser Reise `owner` oder `editor` ist (aus der Reiseliste, `role`). Viewer sehen es nicht.
- Kasten „Am Reisetag“ oben in der Detailansicht, Knopf „Terminal, Schalter, Gate, Kofferband abfragen“ (Zug: „Gleis abfragen“,
  Mietwagen: „Schalter abfragen“). Darunter ruhig: „Sucht auf Live-Seiten von Flughafen, Airline oder Bahn gezielt nach diesem Termin.
  Gespeichert wird erst mit ‚Übernehmen‘.“
- Ablauf (Vertrag in `docs/API.md`, Abschnitt „Reisetag-Abfrage“):
  1. `POST /api/items/:id/place-lookup` → 202 `{lookup}` mit `status: "pending"`.
  2. Alle 3 Sekunden `GET /api/items/:id/place-lookup` → `{lookup}`, bis `status` nicht mehr `pending` ist (höchstens 4 Minuten).
     Während dessen „Sucht …“, Knopf gesperrt. Ein schon laufendes oder fertiges Ergebnis beim Öffnen der Ansicht gleich anzeigen.
  3. `done`: je Fund eine Zeile mit Häkchen: **„Gate B12“** fett, daneben grau „(bisher B14)“ oder „(wie eingetragen)“, darunter klein
     `note` und die Quelle als Link (`source.title`, `source.url`). Vorausgewählt ist, was neu oder anders ist. Darunter `summary`,
     „Stand 14:32“ (`finishedAt`) und „gesucht: …“ (`queries`). Keine Funde: `summary` und „Schau auf die Anzeigetafel oder in die App der
     Airline bzw. Bahn.“
  4. `failed`: `error` als Meldung.
  5. **„Übernehmen (n)“:** `PATCH /api/items/:id` mit `{details: <alle bisherigen details des Eintrags> + die gewählten Werte}`. Wichtig:
     Der Server ersetzt `details` als Ganzes, also immer alle bisherigen Schlüssel mitschicken, nicht nur die neuen. Danach den Ablauf neu
     laden; die anderen Mitglieder bekommen vom Server die Push-Nachricht, dafür tut die App nichts.
- 409 beim Start („läuft bereits“): stattdessen den laufenden Stand abfragen. 403: Hinweis „Nur Bearbeiter können abfragen.“
- Das ist der **erste schreibende Aufruf** der App. Sonst bleibt alles nur lesend.

## Teil D: Prüfen und Rückgabe

- Build grün, keine Warnungen, Unit-Tests grün.
- Im Simulator mit deinem Beispielserver aus dem Scratchpad (wie bei 0.1.0, nicht ins Repo): Offline-Band (Server beenden, App neu
  öffnen), Vorladen, Abmelden löscht den Speicher (Ordner danach leer), Jetzt-Markierung mit einer Reise, die gerade läuft (Testdaten mit
  Zeiten um „jetzt“ herum), ausgegraute Einträge, Reisetag-Abfrage mit erfundener Antwort inklusive „Übernehmen“ (prüfe den gesendeten
  `PATCH`-Körper: alle alten Details plus die neuen).
- **IPA ist freigegeben:** nach grünem Build und Prüfung wie bei 0.1.0 nach `ios/Installation/0.2.0-b2/` mit `SHA256.txt`. Ältere als die
  letzten drei Versionen aus dem Ordner löschen (bleiben in der Historie). Philip installiert selbst.
- `ios/STAND.md` nach Vorlage, dazu „Was Philip auf dem iPhone testen soll“: Flugmodus an → App öffnen → Offline-Band; laufende Reise →
  Markierung; Flug öffnen → Abfrage (nur sinnvoll am Reisetag, sonst meist „nichts gefunden“).
- Auftrag nach `ios/Auftraege/` verschieben, „Neu in 0.2.0“ in `ios/CLAUDE.md`, committen, pull, push.

Offene Fragen in `STAND.md`, nicht raten.
