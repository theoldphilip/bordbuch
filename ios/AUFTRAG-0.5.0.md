# AUFTRAG-0.5.0.md: Erinnerungen am Ort (iOS-Auftrag 5)

Version **0.5.0, Build 5** (Regel 2, App und Widget gleich). Philip hat 0.4.0 auf dem iPhone geprüft, die Testnachricht kommt an.

**Reihenfolge:** Philip hat drei Aufträge auf einmal bestellt: `AUFTRAG-0.5.0.md` (dieser), `AUFTRAG-0.6.0.md` (Bearbeiten),
`AUFTRAG-0.7.0.md` (Dokumente und Teilen). Arbeite sie **nacheinander** ab. Jeder Auftrag wird für sich fertig: Build grün, Tests,
IPA, `STAND.md`, Auftrag nach `ios/Auftraege/`, Commit, Push. Dann ohne Rückfrage mit dem nächsten weitermachen. Halt nur bei
Schritten von Philip (Capability, Target) oder bei einer echten Rückfrage (Regel 8). `STAND.md` beschreibt immer den zuletzt
erledigten Auftrag; ältere Rückgaben stehen in der Git-Historie.

## Teil 0: Vorher
1. Trennungsprüfung aus `ios/CLAUDE.md`, `git pull --rebase origin main`, `git config user.email` = noreply (Regel 7).
2. Neue Capability legt **Philip** an (Regel 5). Anleitung geben, auf „fertig“ warten:
   - Target **Reisebuch** → *Signing & Capabilities* → *+ Capability* → **Background Modes** → nur Häkchen bei **Background fetch**.
3. Prüfen und in `STAND.md`: `Info.plist` der App hat `UIBackgroundModes` = `fetch`, Entitlements unverändert (`aps-environment`,
   App Group); Widget unverändert; `grep -ri GymNative ios/Reisebuch` leer.

## Ziel
Kommt Philip am Reisetag am Flughafen, Bahnhof, Hafen, an der Mietwagen-Station oder am Hotel an, zeigt das iPhone eine Mitteilung mit
den Angaben, die er dort braucht. Beispiel: „✈️ Zürich → Rom: Abflug 09:40 · Terminal 2 · Schalter 3 · Gate B12“. Der Standort verlässt
das iPhone nie, der Server erfährt nichts davon.

## Teil A: Technik
- Lokale Mitteilungen mit **`UNLocationNotificationTrigger`** (`CLCircularRegion`, `notifyOnEntry = true`, `notifyOnExit = false`,
  `repeats: false`). Das braucht nur die Erlaubnis **„Beim Verwenden der App“**, nicht „Immer“. Kein `CLMonitor`, kein Standort im
  Hintergrund.
- `Info.plist`: `NSLocationWhenInUseUsageDescription` = „Reisebuch erinnert dich am Flughafen, Bahnhof oder Hafen an Gate, Gleis und
  Zeiten. Dein Standort verlässt das iPhone nicht.“
- Ortssuche auf dem Gerät mit MapKit (`MKLocalSearch` mit `pointOfInterestFilter`, für Adressen die nicht veraltete Geocoding-API von
  iOS 26). Keine veralteten APIs (keine Warnungen). Ergebnisse je Suchtext zwischenspeichern (Application Support, wird beim Abmelden
  gelöscht wie der übrige Cache). Nichts gefunden: diesen Ort auslassen, nicht raten.
- Neue Datei z. B. `PlaceReminders.swift`. Die **Auswahl** (welche Orte, welcher Text, welcher Radius) als reine Funktion, damit sie
  testbar ist; Ortssuche und Planen der Mitteilungen getrennt davon.

## Teil B: Welche Orte
Nur aus Reisen, die laufen oder kommen (aus dem Offline-Cache, wie das Widget). Zeiten sind Ortszeit + Zeitzone (`NowLogic` verwenden).
Ein Ort wird geplant, wenn sein Zeitpunkt **in den nächsten 36 Stunden** liegt und noch nicht vorbei ist.

| Anlass | Ort (Suchtext) | Radius | Zeitpunkt | Text (nur vorhandene Angaben, mit „ · “ getrennt) |
|---|---|---|---|---|
| Flug | `details.from` (IATA, Suche „<Code> Airport“, Filter Flughafen), sonst `location` | 2000 m | Abflug | `✈️ <title>`: „Abflug HH:MM · Terminal … · Schalter … · Gate …“ |
| Zug | `details.from` (Bahnhof), sonst `location` | 400 m | Abfahrt | `🚆 <title>`: „Abfahrt HH:MM · Gleis … · Wagen/Sitz …“ |
| Einschiffung | Tag `embarkation`: `portName` (+ `country`), Suche „Cruise Terminal <portName>“, sonst Hafen | 1500 m | Tag der Einschiffung bis „Alle an Bord“ | `🚢 <shipName>`: „Einschiffung · Kabine … · Alle an Bord HH:MM“ |
| Mietwagen | `location` | 300 m | Abholung | `🚗 <title>`: „Abholung HH:MM · <provider> · Buchung <confirmation>“ |
| Hotel | `location` | 200 m | Check-in-Tag, ab 6 h vor Beginn bis 12 h danach | `🏨 <title>`: „Check-in ab HH:MM · Zimmer … · Buchung …“ |

- Gate/Schalter/Kofferband/Gleis wie im Ablauf aus `details` (`terminal`, `checkinDesk`, `gate`, `platform`, `desk`; siehe
  `<repo>/docs/API.md` Abschnitt „Terminal, Gate, Schalter, Kofferband, Gleis“). Uhrzeit als Ortszeit, so wie sie dasteht.
- `userInfo["url"]` = `/trips/<id>`: Antippen öffnet die Reise über denselben Weg wie Push und Widget.
- Höchstens **20** geplante Orte (iOS-Grenze), die frühesten zuerst. Kennung `ort-<eintrag-id>` bzw. `ort-day-<tag-id>`.

## Teil C: Planen und Aktualisieren
- Neu planen (alle eigenen `ort-*` entfernen, dann neu anlegen) nach jedem Laden von Liste/Ablauf, beim Start, beim Wechsel in den
  Hintergrund und in einer **`BGAppRefreshTask`** (`BGTaskSchedulerPermittedIdentifiers` = `de.theoldphilip.Reisebuch.refresh`): Liste und
  Abläufe laufender/kommender Reisen neu laden (wie das Vorladen in 0.2.0), Cache, Widget und Orte aktualisieren, nächste Aufgabe in
  etwa 4 Stunden anmelden. Wann iOS die Aufgabe ausführt, entscheidet iOS; das ist eine Ergänzung, keine Garantie.
- Ein Ort, dessen Zeitpunkt vorbei ist, wird beim nächsten Planen entfernt. So meldet sich der Abflughafen nicht bei der Rückreise
  Tage später (die hat einen eigenen Eintrag).
- Abmelden entfernt alle `ort-*` und den Such-Cache.

## Teil D: Einstellungen
- Im Bereich „Benachrichtigungen“ ein zweiter Schalter **„Erinnerungen am Ort“**, standardmäßig **aus**. Gespeichert in `UserDefaults`.
  Einschalten fragt die Mitteilungs-Erlaubnis (falls noch nicht erteilt) und die Standort-Erlaubnis „Beim Verwenden“. Bei Ablehnung:
  Hinweis auf iOS-Einstellungen → Reisebuch → Standort, Schalter bleibt aus. Ausschalten entfernt alle `ort-*`.
- Darunter, nur wenn an: kleine Liste **„Geplant“** mit den Orten der nächsten 36 h (Symbol, Titel, Ort, Uhrzeit) und Orte, die nicht
  gefunden wurden („Ort nicht gefunden: …“), damit Philip sieht, was passieren wird.
- Satz darunter: „Funktioniert, wenn die App in den letzten Stunden vor der Abreise einmal geöffnet war oder iOS sie im Hintergrund
  aktualisieren durfte.“

## Teil E: Prüfen
- Build grün (App, Widget, Tests), keine Warnungen, auch nicht im Archiv-Log.
- Unit-Tests für die Auswahl: Flug mit `from` → Suchtext und Text mit Gate; ohne Ortsfelder nur Uhrzeit; Zeitfenster 36 h (35 h dabei,
  37 h nicht, vorbei nicht); Hotel-Fenster; Einschiffungstag; höchstens 20, die frühesten; Kennungen stabil. Gegenprobe (Logik absichtlich
  ändern, Test wird rot, zurück).
- Simulator mit Beispielserver (Scratchpad): Schalter an, Erlaubnisse, Liste „Geplant“ zeigt die Orte; `xcrun simctl location booted
  set <lat>,<lon>` auf den Flughafen setzen → Mitteilung erscheint, Antippen öffnet die Reise. Wenn der Simulator Standort-Trigger nicht
  auslöst, so in `STAND.md` vermerken (dann auf dem iPhone prüfen).
- **IPA ist freigegeben**, nach `ios/Installation/0.5.0-b5/` mit `SHA256.txt`, nur die letzten drei Versionen behalten. Profil: weiterhin
  `aps-environment` = `production`. `project.pbxproj` nach dem Export unverändert.
- `STAND.md` mit „Was Philip testen soll“ (Schalter an → Liste „Geplant“ ansehen; am Reisetag am Ort), „Neu in 0.5.0“ in `ios/CLAUDE.md`,
  Auftrag nach `ios/Auftraege/`, committen (Identität prüfen), pull, push. Dann weiter mit `AUFTRAG-0.6.0.md`.
