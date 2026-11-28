# STAND (iOS), 28.11.2026

Auftrag: `ios/AUFTRAG-0.5.0.md` (0.5.0, Build 5), erledigt und nach `ios/Auftraege/` verschoben. Danach folgen ohne Rückfrage 0.6.0 und
0.7.0. Rückgabe zu 0.4.0 steht in der Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. `git config user.email` → `noreply@anthropic.com`.

## Teil 0: Capability (von Philip angelegt), Prüfung
- Philip hat beim Target **Reisebuch** „Background Modes“ mit nur „Background fetch“ hinzugefügt.
- `Reisebuch/Info.plist`: `UIBackgroundModes` = `fetch` (sonst nichts). Entitlements unverändert (`aps-environment`, App Group
  `group.de.theoldphilip.Reisebuch`), Widget unverändert, `project.pbxproj` durch die Capability nicht geändert.
  `grep -ri GymNative ios/Reisebuch` leer.
- Von mir in `Info.plist` ergänzt: `NSLocationWhenInUseUsageDescription` (Text wie im Auftrag), `BGTaskSchedulerPermittedIdentifiers` =
  `de.theoldphilip.Reisebuch.refresh`.

## Was ich getan habe
- **`PlaceReminders.swift`** (neu), drei Teile:
  - `OrtAuswahl` (reine Funktion): Kandidaten aus laufenden/kommenden Reisen im Offline-Cache. Flug, Zug, Mietwagen (Abholung), Hotel
    (Check-in), Einschiffungstag. Suchtexte, Radien, Texte wie in der Tabelle des Auftrags; Zeiten über `NowLogic`, Uhrzeit wie sie dasteht.
    Kennungen `ort-<eintrag-id>` / `ort-day-<tag-id>`. Zweite Auftritte (`role: end`, Check-out, Rückgabe) zählen nicht.
  - `OrtSuche`: MapKit auf dem Gerät. Flughafen: `MKLocalSearch` mit Filter `.airport` („ZRH Airport“), Bahnhof mit `.publicTransport`,
    Adressen über `MKGeocodingRequest` (iOS 26), sonst freie Suche. Koordinate aus `MKMapItem.location` (nicht das veraltete `placemark`).
    Ergebnisse je Suchtext in `cache/places.json` (Application Support, Abmelden löscht den Ordner); „nicht gefunden“ wird 12 h gemerkt.
  - `PlaceReminderController`: Schalter, Erlaubnisse, Planen. Planen = alle `ort-*` entfernen, dann höchstens 20 gefundene Orte
    (früheste zuerst) als `UNLocationNotificationTrigger` (`CLCircularRegion`, nur Eintritt, `repeats: false`), `userInfo["url"]` =
    `/trips/<id>` (Antippen öffnet die Reise wie Push und Widget).
- **Wann geplant wird:** nach jedem Laden von Liste/Ablauf/Detail (1 s verzögert gebündelt), beim Start, beim Wechsel in den
  Hintergrund, beim Öffnen der Einstellungen und in der **`BGAppRefreshTask`** (`de.theoldphilip.Reisebuch.refresh`: Liste, Abläufe und
  Details neu laden, Widget und Orte aktualisieren, nächste Aufgabe in etwa 4 h anmelden). Abmelden entfernt alle `ort-*`, Such-Cache und
  Schalter.
- **Reise-Detail** (`GET /trips/:id`) wird jetzt beim Vorladen mitgeladen und gespeichert (`cache/trip-<id>.json`, Modell `TripDetail`
  mit `role` und `cruises`): daraus Schiffsname und Kabine für die Einschiffung. Ohne Detail: Schiff aus dem Abschnittstitel
  („Kreuzfahrt · …“) bzw. `ships`.
- **Einstellungen** → Benachrichtigungen: zweiter Schalter „Erinnerungen am Ort“ (Standard aus). Einschalten fragt Mitteilungen (falls
  nötig) und Standort „Beim Verwenden“; bei Ablehnung Hinweis auf die iOS-Einstellungen, Schalter bleibt aus. Darunter, wenn an: Liste
  „Geplant“ (Titel, gefundener Ort, Wochentag und Uhrzeit) und „Ort nicht gefunden: …“ bzw. „Kein Ort eingetragen: …“. Satz aus dem
  Auftrag als Fußzeile.
- **Tests** (`ReisebuchTests/PlaceReminderTests.swift`, neu, 8): Flug mit `from` (Suchtext „ZRH Airport“, Text mit Terminal/Schalter/Gate,
  ohne Kofferband und Buchungsnummer), ohne Ortsfelder nur Uhrzeit, Zug und Mietwagen, Fenster 36 h (35 h dabei, 37 h nicht, vorbei nicht),
  Hotel-Fenster (6 h vorher bis 12 h danach, Check-out kein zweiter Ort), Einschiffungstag (mit und ohne Detail, nach „Alle an Bord“ weg),
  höchstens 20 die frühesten (nicht gefundene rücken nach), Kennungen stabil. **31/31 grün.** Gegenprobe: Grenze 38 h und Hotel-Fenster
  ohne die 6 h → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- **iOS kennt für Orts-Mitteilungen kein Zeitfenster.** Ein geplanter Ort meldet sich beim ersten Betreten, egal wann. Das Fenster wirkt
  nur über das Planen: Geplant wird, was in den nächsten 36 h beginnt; Vorbeigehendes fällt beim nächsten Planen weg. Folge: Wer z. B. am
  Vorabend am Abflughafen vorbeifährt, bekommt die Mitteilung dann schon.
- Wer beim Planen schon im Kreis steht, bekommt keine Mitteilung (iOS meldet nur das Betreten).
- Einschiffung: Fenster vom Tagesbeginn bis „Alle an Bord“ (ohne: Abfahrt, sonst Tagesende); gesucht wird „Cruise Terminal <Hafen>, <Land>“,
  danach „Hafen <Hafen>, <Land>“.
- Hotel: nur mit eingetragener Adresse (`location`), gesucht als Adresse, danach „<Titel>, <Adresse>“. Ohne Adresse wird nicht geraten.
- Mietwagen-Text enthält zusätzlich den Schalter (`desk`), wie die Ortsfelder im Ablauf.
- Zug: `seat` heißt in der Web-App „Wagen / Platz“, daher „Wagen/Platz …“.
- Abmelden schaltet „Erinnerungen am Ort“ aus (wie den Push-Schalter).

## Build-Ergebnis
Grün (Debug Simulator, Tests, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log. Verbleibend nur die bekannte
Meldung `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).
**Keine Prüfung im Simulator** (Philips Entscheidung vom 28.11.2026), nur Build und Unit-Tests. Nicht geprüft sind damit: Erlaubnis-Dialoge,
Ortssuche mit echten Orten, Auslösen der Mitteilung, Hintergrund-Aktualisierung.

## IPA
- `ios/Installation/0.5.0-b5/Reisebuch-0.5.0-b5.ipa`, 553 555 Bytes, App und Widget je 0.5.0 (5).
- SHA256: `feda0e3c9287b4e8b86f3fd56fe862a421785806afc329e36be39b4c8bb90196`
- Profile unverändert (kein neues Profil nötig): App 22d2bb98… mit `aps-environment` = `production` (auch in der signierten App), Widget
  a8497ea0…, beide 2 Geräte, gültig bis 01.11.2027, App Group nur `group.de.theoldphilip.Reisebuch`.
- `project.pbxproj` nach Archiv und Export unverändert.
- **IPA noch nicht im Git:** Bei 0.3.0 und 0.4.0 hat die Sicherheitsprüfung meiner Sitzung den Push der IPA blockiert. Damit die
  Code-Commits von 0.6.0 und 0.7.0 nicht hinter einem ungepushten IPA-Commit hängen, liegen die IPAs bis zum Ende von 0.7.0 nur im
  Arbeitsordner und kommen dann in einem Commit (alte Versionen werden dabei entfernt).

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (nur Version 0.5.0 / Build 5, 8 Vorkommen je Schlüssel)
- `ios/Reisebuch/Reisebuch/`: `Info.plist` (Philip: Background fetch; ich: Standort-Text, BGTask-Kennung), `APIClient.swift`,
  `AppSession.swift`, `Models.swift`, `Push.swift` (AppDelegate), `ReisebuchApp.swift`, `ResponseCache.swift`, `SettingsView.swift`,
  neu `PlaceReminders.swift`
- `ios/Reisebuch/ReisebuchTests/PlaceReminderTests.swift` (neu)
- `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- 27cfe3e iOS 0.5.0: Erinnerungen am Ort
- folgender Commit: iOS 0.5.0 (5): STAND, Auftrag abgeschlossen

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: fehlendes Zeitfenster bei Orts-Mitteilungen (siehe Entscheidungen).

## Was Philip auf dem iPhone testen soll
1. IPA 0.5.0-b5 installieren, App mit VPN öffnen und die Reiseliste laden lassen.
2. Einstellungen → Benachrichtigungen → „Erinnerungen am Ort“ einschalten. Erst Mitteilungen (falls noch nicht erlaubt), dann Standort
   „Beim Verwenden der App erlauben“. Der Schalter bleibt an.
3. Darunter die Liste „Geplant“ ansehen: Stehen dort die Flüge, Züge, Hotels, Mietwagen und Einschiffungen der nächsten 36 Stunden mit
   einem sinnvollen Ort (z. B. „Flughafen Zürich“) und der richtigen Ortszeit? Steht etwas unter „Ort nicht gefunden“, bitte Screenshot:
   dann passt der Suchtext nicht (z. B. Hotel ohne Adresse).
4. Standort ablehnen (iOS-Einstellungen → Reisebuch → Standort auf „Nie“, dann in der App Schalter aus und wieder an): Hinweis erscheint,
   Schalter bleibt aus.
5. Am Reisetag: kurz vor der Abreise die App einmal öffnen. Beim Ankommen am Flughafen/Bahnhof/Hafen/Hotel kommt die Mitteilung, z. B.
   „✈️ Zürich → Rom“ / „Abflug 09:40 · Terminal 2 · Schalter 3 · Gate B12“. Antippen öffnet die Reise.
6. Abmelden → „Erinnerungen am Ort“ ist aus; nach dem Anmelden wieder einschalten.
