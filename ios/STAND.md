# STAND (iOS), 27.11.2026, 15:35

Auftrag: `ios/AUFTRAG-0.3.0.md` (0.3.0, Build 3), erledigt und nach `ios/Auftraege/` verschoben. Rückgabe zu 0.2.0 steht in der
Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. Commit-Identität fest im Klon (`git config --local`), `git config user.email` → `noreply@anthropic.com`.

## Teil 1 und 2: Target und App Group (von Philip angelegt), Prüfung
- Ablauf: Beim ersten Anlegen entstand das Widget-Target doppelt (zweimal `ReisebuchWidgetExtension`). Philip hat eines gelöscht; dabei
  verschwand die Einbettung in die App, die er unter *Build Phases → Embed Foundation Extensions* wieder hinzugefügt hat. „Activate
  scheme?“ wurde mit „Do not activate“ beantwortet; das Schema `ReisebuchWidgetExtension` existiert trotzdem, gebaut wird über `Reisebuch`.
  Außerdem von Philip in Xcode: `WidgetStand.swift` zusätzlich ins Widget-Target, URL-Typ `reisebuch` (legte `Reisebuch/Info.plist` an).
- Bundle-IDs: `de.theoldphilip.Reisebuch`, `de.theoldphilip.Reisebuch.ReisebuchWidget`, `de.theoldphilip.ReisebuchTests`,
  `de.theoldphilip.ReisebuchUITests`.
- Entitlements: genau zwei (`Reisebuch/Reisebuch.entitlements`, `ReisebuchWidgetExtension.entitlements`), jede nur mit
  `group.de.theoldphilip.Reisebuch`. `grep -ri GymNative ios/Reisebuch` leer.
- Targets (`xcodebuild -list`): Reisebuch, ReisebuchTests, ReisebuchUITests, ReisebuchWidgetExtension.
- Beispielcode von Xcode im Widget-Ordner vollständig ersetzt.
- Von mir im Projekt gesetzt: Version 0.3.0 / Build 3 in allen 8 Vorkommen (Widget hatte 1.0 / 1), `TARGETED_DEVICE_FAMILY = 1` auch beim
  Widget (Xcode hatte iPhone und iPad gesetzt; die App ist nur iPhone).

## Was ich getan habe
- **Teil 3, Daten** (`WidgetStand.swift` in beiden Targets, `WidgetFeed.swift` nur App): Format wie im Auftrag
  (`{updated, termine: [{start, ende, tz, symbol, titel, ort, reise, reiseId}]}`, ms als Int64, `ort` ohne Wert als `null`) in
  `UserDefaults(suiteName: "group.de.theoldphilip.Reisebuch")`, Schlüssel `widget_stand`. Auswahl aus den gespeicherten Abläufen laufender
  und kommender Reisen: Ende nach jetzt, Beginn höchstens 7 Tage voraus, nach Beginn sortiert (bei gleichem Beginn Reihenfolge des Ablaufs),
  höchstens 30. Beginn = neues `NowLogic.entryStart` (wie `Trip.tsx`), Ende = `entryEnd`. Titel wie im Ablauf (`Check-out · …` usw.), `ort`
  = fette Ortszeile. Kreuzfahrt-Tag außer Seetag: Termin „Alle an Bord · <Hafen>“ zu `allAboard`, sonst `departure`, in der Zone des Tages.
  Aktualisiert nach jedem geladenen Ablauf und jeder Liste (auch beim Vorladen) und beim Start aus dem Zwischenspeicher;
  `reloadAllTimelines()` nur bei geänderten Terminen. Abmelden und 401 löschen `widget_stand` und laden das Widget neu.
- **Teil 4, Widget** (`ReisebuchWidget/ReisebuchWidget.swift`): `accessoryRectangular`, `accessoryInline`, `systemSmall`, `systemMedium`.
  Erster Termin mit `ende >= jetzt`; läuft er: „läuft · bis 11:58“, sonst Uhrzeit, mehr als 24 h vorher „Mo. 09:40“, alles in der Zone des
  Termins. Darunter Symbol und Titel, Ort fett. Mittel: dazu „Danach …“ und der Reisetitel (Kopfzeile). Eine Zeile: „09:40 ✈️ Gate B12“,
  ohne Ort Titel gekürzt. Leer: „Keine Termine in den nächsten 7 Tagen“ bzw. „Reisebuch“ + „Nicht angemeldet“ (eine Zeile:
  „Reisebuch · Nicht angemeldet“). Timeline: jetzt, jeder Beginn, 24 h vor jedem Beginn, 1 min nach jedem Ende; `.atEnd`. Antippen:
  `reisebuch://trip/<reiseId>`, ohne Termin `reisebuch://` (öffnet nur die App). Keine Netzanfragen, keine Buchungsnummern, Preise,
  Telefonnummern.
- **App**: `.onOpenURL` → `AppSession.handle(url:)`; die Reiseliste nutzt jetzt `NavigationStack(path:)` und öffnet die Reise, sobald sie in
  der Liste steht (kalt und bei laufender App, Einstellungen werden dabei geschlossen).
- **Tests** (`ReisebuchTests/WidgetTests.swift`, neu, 7): Auswahl (7-Tage-Grenze genau, vergangene raus, Hafentag „Alle an Bord“ in
  Lissabonner Zeit, `role: "end"` als „Check-out · …“, Flug-Ende in Ankunftszone, keine Buchungsnummer im Stand), 30er-Grenze, Abfahrt ohne
  „Alle an Bord“, Widget-Auswahl läuft/kommt/Wochentag/keiner, Uhrzeit in fremder Zone, Zeitpunkte der Timeline, Ablage (Änderung erkannt,
  löschen, Format). **19/19 grün.** Gegenprobe: Grenze auf 8 Tage und `role: "end"` ohne Präfix → Test rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- Timeline-Einträge zusätzlich 24 h vor jedem Beginn (dann fällt der Wochentag weg) und 1 min **nach** jedem Ende statt genau zum Ende
  (zum Ende selbst gilt `ende >= jetzt` noch).
- Zeitpunkte ohne Dauer („Alle an Bord“, Check-in) zeigen nie „läuft“, sondern die Uhrzeit.
- Eine Zeile bei laufendem Termin: „bis 11:58 ✈️ Gate B12“ (ohne „läuft ·“, sonst zu lang für den Sperrbildschirm).
- Kompass im Widget als SF Symbol `safari`, nicht das App-Symbol (passt sich Hell/Dunkel und Sperrbildschirm an).
- `ort` auch beim zweiten Auftritt (z. B. Rückgabe Mietwagen), wie die fette Zeile im Ablauf.
- Ohne Termine: Neuladen nach 1 h statt `.atEnd` (bei nur einem Eintrag würde `.atEnd` sofort neu anfragen).
- Galerie und Platzhalter zeigen den echten Stand (nicht angemeldet → „Nicht angemeldet“), Beispieldaten nur in den Xcode-Vorschauen.

## Prüfung im Simulator (Beispielserver im Scratchpad, erfundene Daten, nicht im Repo)
- Anmelden gegen den Beispielserver (Wegwerf-UI-Test, gelöscht): `widget_stand` im App-Group-Container enthielt den laufenden Flug mit
  „Terminal 1 · Gate B14“, Taxi, Hotel, „Check-out · Hotel …“; der vergangene Zug fehlte.
- **Klein und mittel** in der Widget-Galerie: „läuft · bis 16:01“, Titel, fett „Terminal 1 · Gate B14“; mittel zusätzlich „Danach 17:01 …
  Taxi zum Hotel“ und der Reisetitel. Emojis erscheinen im Simulator als „?“ (bekannt).
- **Antippen**: `reisebuch://trip/t1` bei beendeter App → Ablauf der Reise offen (Titelleiste geprüft), dann `…/t2` bei laufender App →
  andere Reise offen.
- **Abmelden**: `widget_stand` gelöscht (Plist leer), Galerie zeigt „Reisebuch / Nicht angemeldet“.
- **Nicht geprüft**: Sperrbildschirm-Größen (`accessoryRectangular`, `accessoryInline`) nur über Code und Tests, nicht als Bild. Das Widget
  auf den Home-Bildschirm legen: Ein UI-Test, der auf „Widget hinzufügen“ tippt, ließ SpringBoard im Simulator abstürzen; deshalb Galerie.
  Ebenso nicht geprüft: echter Server, Weiterspringen über Stunden ohne App, Flugmodus auf dem Gerät.
- Versehen: Bei einer leeren Shell-Variable hat ein `ls` einmal den Mac-Ordner `/Library/Preferences` aufgelistet (nur Dateinamen, nichts gelesen).

## Build-Ergebnis
Grün (Debug Simulator, Clean Build, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log. Verbleibend nur die bekannte
Meldung `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).

## IPA
- `ios/Installation/0.3.0-b3/Reisebuch-0.3.0-b3.ipa`, 459 045 Bytes, App und Widget je 0.3.0 (3), URL-Schema `reisebuch` enthalten.
- SHA256: `c4f9a86871ab4f2a0823005757f038a2c56a842b991841fd85c502aa6ffe8086`
- Profile (von Xcode mit `-allowProvisioningUpdates` erzeugt):
  - App: „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch“ **erneuert** (wegen App Group; neue UUID d90aa876…, das alte
    8fb0a89a… wurde ersetzt), 2 Geräte, gültig bis 01.11.2027, App Group `group.de.theoldphilip.Reisebuch`.
  - Widget: „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch.ReisebuchWidget“ **neu** (a8497ea0…), 2 Geräte, gültig bis
    01.11.2027, dieselbe App Group.
- `project.pbxproj` nach Archiv und Export unverändert (Vergleich mit Kopie vor dem Archiv).
- Im Ordner liegen 0.1.0-b1, 0.2.0-b2, 0.3.0-b3 (drei Versionen, nichts gelöscht).

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (Widget-Target und App Group von Philip, Version und Gerätefamilie von mir)
- `ios/Reisebuch/Reisebuch/`: `AppSession.swift`, `NowLogic.swift`, `ReisebuchApp.swift`, `TripListView.swift`, neu `WidgetStand.swift`,
  `WidgetFeed.swift`, `Info.plist`, `Reisebuch.entitlements`
- `ios/Reisebuch/ReisebuchWidget/` (neu), `ios/Reisebuch/ReisebuchWidgetExtension.entitlements` (neu)
- `ios/Reisebuch/ReisebuchTests/WidgetTests.swift` (neu)
- `ios/Installation/0.3.0-b3/`, `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- f531408 iOS 0.3.0: Widget „Nächster Termin“
- folgender Commit: iOS 0.3.0 (3): STAND, Auftrag abgeschlossen
- IPA in eigenem Commit (siehe Rückmeldung im Terminal)

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: die Entscheidungen oben, vor allem die zusätzlichen Timeline-Zeitpunkte und die gekürzte Zeile bei
  laufendem Termin.

## Was Philip auf dem iPhone testen soll
1. IPA 0.3.0-b3 installieren, App einmal mit VPN öffnen (Liste und Abläufe laden).
2. Home-Bildschirm: lange drücken → Bearbeiten → Widget hinzufügen → „Reisebuch“ → klein und mittel hinzufügen. Zeigt es den nächsten
   Termin mit Uhrzeit in Ortszeit und fett Gate/Schalter/Gleis?
3. Sperrbildschirm: lange drücken → Anpassen → Sperrbildschirm → Widgets → „Reisebuch“ rechteckig, und die Zeile über der Uhr. Lesbar?
4. Flugmodus an, App nicht öffnen, später wieder ansehen: Das Widget springt ohne App zum nächsten Termin weiter.
5. Widget antippen → App öffnet den Ablauf der Reise dieses Termins.
6. In der App abmelden → Widget zeigt „Nicht angemeldet“. Wieder anmelden → Termine kommen zurück.
