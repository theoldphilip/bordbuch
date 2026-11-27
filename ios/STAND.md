# STAND (iOS), 27.11.2026, 11:15

Auftrag: `ios/AUFTRAG-0.2.0.md` (0.2.0, Build 2), erledigt und nach `ios/Auftraege/` verschoben. Rückgabe zu 0.1.0 und zur IPA 0.1.0
steht in der Git-Historie dieser Datei (Commit 0ccf07b).

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
Bundle-IDs                     -> de.theoldphilip.Reisebuch, …ReisebuchTests, …ReisebuchUITests
```
Ergebnis: bestanden.

## Was ich getan habe
- **Version** 0.2.0 / Build 2 in allen 6 Vorkommen.
- **Teil A, offline lesen** (`ResponseCache.swift`, `AppSession.swift`): rohe Antworten von `GET /api/trips` und
  `GET /api/trips/:id/timeline` in Application Support/`cache/` (`trips.json`, `timeline-<id>.json`), Dateischutz
  `completeUntilFirstUserAuthentication`, Ordner und Dateien `isExcludedFromBackup`. Zeitpunkt = Änderungsdatum der Datei.
  Erst Gespeichertes zeigen, dann laden; ist der Server nicht erreichbar, bleibt das Gespeicherte mit Band „Offline · Stand Fr., 27. Nov.,
  11:01“ (grau, Wolke durchgestrichen). Andere Fehler (z. B. 500) zeigen das Gespeicherte plus die Fehlermeldung. Ohne Gespeichertes die
  bisherige Meldung. Vorladen der Abläufe laufender und kommender Reisen nach jeder geladenen Liste, höchstens 5 gleichzeitig, still.
  Gelöschte Reisen: Datei weg beim nächsten Laden der Liste. Abmelden und 401 löschen den ganzen Zwischenspeicher.
- **Teil B, Jetzt-Markierung** (`NowLogic.swift`, `TripTimelineView.swift`): `entryEnd`, `dayEnd`, Element-Reihenfolge und Position wie
  `Trip.tsx`; Ortszeit → Zeitpunkt mit `Calendar` der IANA-Zone, nur Datum = 23:59 (Ende) bzw. 00:00 (Beginn). Vergangene Einträge und
  Hafentage mit Deckkraft 0.45, Tagesüberschrift blasser, wenn alles vorbei ist. Markierung „Jetzt · 11:01“ (Rosa `#d6336c`, dünne Linie)
  vor dem ersten Element, das noch nicht vorbei ist, nur wenn schon eines vorbei ist. Aktualisierung jede Minute und bei `scenePhase == .active`.
  Einmaliges Scrollen zur Markierung beim Öffnen.
- **Teil C, Reisetag-Abfrage** (`PlaceLookupView.swift`, `APIClient.swift`): Kasten „Am Reisetag“ in der Detailansicht von Flug, Zug,
  Mietwagen, nur wenn `GET /api/ai/status` → `placeLookup: true` (beim Start abgefragt, in UserDefaults gemerkt) und Rolle owner/editor.
  POST → Abfragen alle 3 s bis fertig (höchstens 80 × 3 s = 4 min), laufendes/fertiges Ergebnis beim Öffnen. Funde mit Häkchen, Vergleich
  „(bisher …)“ / „(wie eingetragen)“ / „(neu)“, Hinweis, Quelle als Link; vorausgewählt, was neu oder anders ist; `summary`, „Stand“,
  „gesucht: …“; ohne Funde der Hinweis auf Anzeigetafel/App. 409 → laufenden Stand abfragen, sonst Meldung; 403 → „Nur Bearbeiter können
  abfragen.“ „Übernehmen (n)“ schickt `PATCH /api/items/:id` mit **allen** bisherigen details (roh, Zahlen bleiben Zahlen, null bleibt null)
  plus den gewählten Werten; danach zeigt die Ansicht den zurückgegebenen Eintrag und der Ablauf wird neu geladen. Offline: Knopf grau,
  „Nur mit Verbindung“.
- `details` wird jetzt verlustfrei als JSON gelesen (`JSONValue`), angezeigt wird weiter nur Text.
- **Tests** (`ReisebuchTests/NowLogicTests.swift`, neu): Ortszeit → Zeitpunkt (Sommerzeit-Beginn und -Ende, nur Datum), Flug mit zwei Zonen,
  Ende je Typ (Hotel Check-in/Check-out, Mietwagen, Parkplatz, Station, Zug ohne Ende, Ausflug, Notiz nur Datum), Hafentag/Seetag,
  Markierung (vorher keine, im Flug keine, mittendrin richtig inkl. Zone, nach der Reise keine), Vorauswahl und PATCH-Körper, Zwischenspeicher
  (speichern, Zeitpunkt, aufräumen, Backup-Ausnahme, löschen). **12/12 grün.** Gegenprobe: „hotel“ aus den mehrtägigen Typen entfernt und
  `mergedDetails` ohne alte Details → beide Tests rot, danach zurückgestellt.

## Abweichungen von der Web-App / Entscheidungen
- Uhrzeit der Markierung in der Zone des folgenden Elements (laut Auftrag); die Web-App nimmt `defaultTimezone`.
- Hafentag: Überschrift und Hafenkarte sind in der App eine Zeile. Steht „Jetzt“ vor einem Hafentag, steht die Markierung daher immer vor der
  Tagesüberschrift (die Web-App setzt sie bei einem heutigen Tag zwischen Überschrift und Karte).
- Vergleich der Funde nach dem Übernehmen mit dem aktuellen Wert des Eintrags, damit nicht weiter „(bisher B14)“ dasteht.

## Prüfung im Simulator (Beispielserver nur im Scratchpad, erfundene Daten, nicht im Repo)
- Server mit laufender Reise (Zeiten relativ zu jetzt), kommender und vergangener Reise, `ai/status`, erfundener Abfrage, Protokoll der
  Anfragen. Gesteuert über Wegwerf-UI-Tests (gelöscht, nicht committet).
- **Vorladen:** Protokoll zeigt `GET /api/trips/t1/timeline` und `…/t2/timeline`, **nicht** t3 (vergangen).
- **Jetzt:** Zug von 05:58 ausgegraut, Markierung „Jetzt · 11:01“ vor dem Flug (Abflug 08:58, Landung 11:58), Rest normal.
- **Abfrage:** „Sucht …“ mit gesperrtem Knopf, dann Gate B12 (bisher B14) und Schalter 31–40 (neu) vorausgewählt, Terminal 1 (wie
  eingetragen) nicht. Gesendeter Körper laut Protokoll:
  `{"details": {"airline": "Beispiel Air", "checkinDesk": "31–40", "flightNumber": "BA 204", "from": "ZRH", "gate": "B12", "pieces": 2,
  "seat": "14A", "terminal": "1", "to": "LIS"}}` (alle alten Schlüssel, `pieces` als Zahl). Danach „2 Angaben übernommen.“, Kopfzeile
  „Terminal 1 · Schalter 31–40 · Gate B12“, Ablauf neu geladen.
- **Offline** (Server beendet, App neu gestartet): Band in Liste und Ablauf, kommende Reise ohne vorheriges Öffnen lesbar, übernommenes Gate
  im gespeicherten Ablauf, Abfrageknopf grau mit „Nur mit Verbindung“.
- **Abmelden:** Speicherordner im App-Container danach leer (`ls` geprüft).
- Nicht geprüft: echter Server, echte KI-Abfrage, Verhalten über Mitternacht und echte Zeitzonenwechsel auf Reisen, Flugmodus auf dem Gerät.

## Build-Ergebnis
Grün (Debug Simulator und Release-Archiv), keine Compiler-Warnungen. Im Release-Archiv kam zuerst eine Concurrency-Warnung
(`ResponseCache.swift:65`, `map(timelineFile)`), die der Debug-Build nicht zeigte; behoben (Commit 5d977a0). Verbleibend nur die bekannte
Meldung `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).

## IPA
- `ios/Installation/0.2.0-b2/Reisebuch-0.2.0-b2.ipa`, 388 816 Bytes, Version 0.2.0, Build 2, Ad-hoc (`ExportOptions.plist` wie bei 0.1.0).
- SHA256: `223b25dda418e425a2d0596f905c5654c65e5b301f5cd0578514e907e45ca9b5`
- Profil: „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch“ (dasselbe wie bei 0.1.0), 2 Geräte, gültig bis 01.11.2027.
  Kein neues Profil entstanden. `project.pbxproj` nach dem Export unverändert.
- Im Ordner liegen 0.1.0-b1 und 0.2.0-b2; nichts gelöscht (höchstens drei Versionen).

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (Version)
- `ios/Reisebuch/Reisebuch/`: `Models.swift`, `APIClient.swift`, `AppSession.swift`, `Format.swift`, `TripListView.swift`,
  `TripTimelineView.swift`, `DetailViews.swift`, neu `ResponseCache.swift`, `NowLogic.swift`, `PlaceLookupView.swift`
- `ios/Reisebuch/ReisebuchTests/NowLogicTests.swift` (neu)
- `ios/Installation/0.2.0-b2/` (IPA, SHA256), `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- 23c6dae iOS 0.2.0: offline lesen, Jetzt-Markierung, Reisetag-Abfrage
- 5d977a0 iOS 0.2.0: Concurrency-Warnung im Release-Build behoben
- folgender Commit: iOS 0.2.0 (2): IPA, STAND, Auftrag abgeschlossen

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: die zwei Abweichungen oben (Zone der Markierungszeit, Markierung vor Hafentag-Zeile).
- `ai/status` wird mit Token abgefragt; der Server antwortet laut Code auch ohne. Falls er künftig Anmeldung verlangt, passt es so.

## Was Philip auf dem iPhone testen soll
1. App einmal mit VPN öffnen (Liste lädt, Abläufe werden vorgeladen), kurz warten.
2. Flugmodus an (oder VPN aus) → App ganz schließen und neu öffnen → Band „Offline · Stand …“ in der Liste; eine kommende Reise öffnen,
   die du in der App noch nie geöffnet hast → Ablauf da.
3. Eine laufende Reise (falls gerade eine läuft) → vergangene Einträge blasser, „Jetzt · hh:mm“ an der richtigen Stelle, App scrollt dorthin.
4. Mit VPN einen Flug öffnen → Kasten „Am Reisetag“ → abfragen. Außerhalb des Reisetags findet sie meist nichts; dann steht der Hinweis
   auf Anzeigetafel/App. Nur am Reisetag „Übernehmen“ testen (die anderen Mitglieder bekommen eine Push-Nachricht).
5. Als Viewer einer Reise (falls vorhanden): kein Kasten „Am Reisetag“.
6. Abmelden, wieder anmelden: Liste lädt neu (Zwischenspeicher war gelöscht).
