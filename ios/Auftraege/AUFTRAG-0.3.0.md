# AUFTRAG-0.3.0.md: Widget „Nächster Termin“ (iOS-Auftrag 3)

Version **0.3.0, Build 3** (Regel 2, alle Vorkommen, jetzt auch im neuen Widget-Target; App und Widget müssen gleich sein).
Philip hat 0.2.0 auf dem iPhone geprüft: offline, Jetzt-Markierung und Reisetag-Abfrage sind in Ordnung.

## Teil 0: Vorher

1. Trennungsprüfung aus `ios/CLAUDE.md`, `git pull --rebase origin main`.
2. **Regel 7 neu lesen** und die Commit-Identität fest im Klon einstellen (`git config --local …`), dann `git config user.email` prüfen.
3. Dieser Auftrag bringt ein **neues Target** und eine **App Group**. Beides legt **Philip** in Xcode an (Regel 5). Gib ihm die Anleitung
   aus Teil 1 im Terminal und warte auf sein „fertig“.

## Teil 1: Was Philip in Xcode anlegt

**A. Widget-Erweiterung**
1. Projekt `ios/Reisebuch/Reisebuch.xcodeproj` öffnen (nur dieses, kein anderes Projekt).
2. *File → New → Target… → iOS → Widget Extension*.
3. Product Name **`ReisebuchWidget`** (ergibt `de.theoldphilip.Reisebuch.ReisebuchWidget`), Team wie die App.
   **Aus:** „Include Live Activity“, „Include Control“, „Include Configuration App Intent“. Embed in **Reisebuch**.
4. Die Frage „Activate scheme?“ mit *Activate* beantworten.

**B. App Group** (damit die App dem Widget fertige Daten hinlegen kann; das Widget geht nie selbst ins Netz)
1. Target **Reisebuch** → *Signing & Capabilities* → *+ Capability* → *App Groups* → `+` → **`group.de.theoldphilip.Reisebuch`**.
2. Dasselbe beim Target **ReisebuchWidgetExtension** (dieselbe Gruppe, Häkchen setzen).
3. **Nicht** die Gruppe des Gym-Projekts wählen, auch wenn Xcode sie in der Liste anbietet (`group.de.theoldphilip.GymNative`).

## Teil 2: Was du danach prüfst (in `STAND.md`)

- Bundle-IDs (`grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' … | sort -u`): nur `de.theoldphilip.Reisebuch`,
  `de.theoldphilip.Reisebuch.ReisebuchWidget` und die Test-IDs.
- Entitlements: genau zwei Dateien (App und Widget), jede enthält als App Group **nur** `group.de.theoldphilip.Reisebuch`.
  `grep -ri "GymNative" ios/Reisebuch` muss leer sein.
- Targets laut `xcodebuild -list`: Reisebuch, ReisebuchWidgetExtension, ReisebuchTests, ReisebuchUITests.
- Den Beispielcode von Xcode im Widget-Ordner durch den eigenen ersetzen (Teil 4); nichts aus Vorlagen anderer Projekte.

## Teil 3: Die App legt die Daten hin

- Neue Datei `WidgetStand.swift`, **in beiden Targets** (App und Widget): das gemeinsame Datenformat, ohne SwiftUI-Abhängigkeit.
- Gespeichert in `UserDefaults(suiteName: "group.de.theoldphilip.Reisebuch")`, Schlüssel `widget_stand`, als JSON:
  `{ updated: <ms Int64>, termine: [ { start: <ms Int64>, ende: <ms Int64>, tz: "<IANA>", symbol: "✈️", titel: "…", ort: "Terminal 1 ·
  Gate B12" | null, reise: "<Reisetitel>", reiseId: "<id>" } ] }`. Zeitpunkte als `Int64` (Millisekunden).
- **Welche Termine:** aus den Abläufen der laufenden und kommenden Reisen, die die App ohnehin hat (Zwischenspeicher aus 0.2.0), alle
  Elemente, deren Ende (`entryEnd`/`dayEnd` aus `NowLogic.swift`) in der Zukunft liegt und deren Beginn höchstens **7 Tage** voraus ist,
  nach Beginn sortiert, höchstens **30**.
  - Eintrag: Beginn = `entryStart`, Ende = `entryEnd`, Titel wie im Ablauf (bei `role: "end"` mit „Check-out · …“ usw.), `ort` = die fette
    Ortszeile (Terminal/Schalter/Gate/Kofferband, Gleis, Schalter) oder `null`.
  - Hafentag (nicht Seetag): ein Termin „Alle an Bord“ mit Beginn = Ende = `allAboard` (sonst `departure`) in der Zone des Tages, Titel
    „Alle an Bord · <Hafen>“, Symbol 🛳️, `ort` null.
- **Wann:** nach jedem erfolgreichen Laden eines Ablaufs und der Liste (auch beim Vorladen) und beim Start aus dem Zwischenspeicher.
  `WidgetCenter.shared.reloadAllTimelines()` **nur, wenn sich `termine` geändert hat**.
- **Abmelden** löscht `widget_stand` und lädt das Widget neu (dann zeigt es „Nicht angemeldet“).

## Teil 4: Das Widget

- Größen: Sperrbildschirm **`accessoryRectangular`** und **`accessoryInline`**, Home-Bildschirm **`systemSmall`** und **`systemMedium`**.
- Inhalt: der **aktuelle oder nächste Termin** = der erste Termin mit `ende >= jetzt`.
  - Läuft er schon (`start <= jetzt`): „läuft · bis 11:58“; sonst Uhrzeit des Beginns, bei mehr als 24 h vorher mit Wochentag
    („Sa. 09:40“). Uhrzeiten in der Ortszeit des Termins (`tz`), wie in der App.
  - Darunter `titel`, darunter `ort` **fett**, falls vorhanden (das ist am Gate das Wichtigste).
  - `systemMedium`: zusätzlich der folgende Termin klein und der Reisetitel.
  - `accessoryInline`: eine Zeile, z. B. „09:40 ✈️ Gate B12“ (ohne `ort`: Titel gekürzt).
- **Kein Termin in 7 Tagen:** „Keine Termine in den nächsten 7 Tagen“. Ohne Daten (nie angemeldet, abgemeldet): „Reisebuch · Nicht angemeldet“.
- **Timeline:** Einträge zu jetzt und zu jedem `start` und `ende` der gespeicherten Termine, damit das Widget ohne App weiterspringt;
  Richtlinie `.atEnd`. Keine Netzanfragen im Widget, keine Rechnung außer der Auswahl.
- **Antippen** öffnet die App mit der Reise des Termins: `widgetURL(URL(string: "reisebuch://trip/<reiseId>"))`, URL-Schema `reisebuch`
  in der App registrieren und dort die Reise öffnen (Liste, dann Ablauf). Ohne Termin: App öffnen.
- Aussehen ruhig, Systemschrift, Hell/Dunkel wie das System, Kompass-Symbol klein in `systemSmall`/`systemMedium`. Auf dem Sperrbildschirm
  keine Farben erzwingen (iOS färbt selbst).
- **Datenschutz-Entscheidung:** Das Widget zeigt seine Angaben auch bei gesperrtem iPhone (am Gate ist das der Sinn). Keine Buchungsnummern,
  keine Preise, keine Telefonnummern im Widget.

## Teil 5: Prüfen und Rückgabe

- Build grün für App **und** Widget, keine Warnungen, Unit-Tests grün. Neue Tests: Auswahl der Termine (7-Tage-Grenze, 30er-Grenze,
  vergangene raus, Hafentag „Alle an Bord“, `role: "end"`), Auswahl im Widget (läuft/kommt/keiner), Zeitpunkte der Timeline-Einträge.
- Im Simulator mit deinem Beispielserver: Widget auf den Home-Bildschirm legen (im Simulator geht das per Hand über die Widget-Galerie;
  falls nicht per Kommandozeile möglich, die Vorschau per `#Preview` bzw. Bildschirmfoto der Widget-Galerie), alle vier Größen ansehen,
  Antippen öffnet die richtige Reise, Abmelden → „Nicht angemeldet“.
- **IPA ist freigegeben**, wie gehabt nach `ios/Installation/0.3.0-b3/`. Durch das Widget und die App Group entstehen neue bzw. erneuerte
  Ad-hoc-Profile: in `STAND.md` melden, welche, und dass `project.pbxproj` nach dem Export nicht weiter verändert wurde.
  Vor dem Push: `git log -1 --format='%ae %ce'` = noreply.
- `STAND.md`, „Was Philip testen soll“ (Widget auf Sperr- und Home-Bildschirm legen, im Flugmodus ansehen, antippen), „Neu in 0.3.0“ in
  `ios/CLAUDE.md` (dazu im Abschnitt „Aufbau“: Widget-Target, App Group `group.de.theoldphilip.Reisebuch`, Schlüssel `widget_stand`),
  Auftrag nach `ios/Auftraege/`, committen, pull, push.
