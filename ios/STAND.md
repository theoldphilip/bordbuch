# STAND (iOS), 28.11.2026

Auftrag: `ios/AUFTRAG-0.6.0.md` (0.6.0, Build 6), erledigt und nach `ios/Auftraege/` verschoben. Danach folgt ohne Rückfrage 0.7.0.
Rückgabe zu 0.5.0 steht in der Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. `git config user.email` → `noreply@anthropic.com`. Keine neue Capability, Entitlements unverändert.

## Was ich getan habe
- **Rechte und Ansichtsmodus** (`EditLogic.swift` → `ViewMode`, `TripTimelineView.swift`): Rolle aus `GET /trips/:id` (`TripDetail.role`,
  sonst aus der Liste). Bearbeiten nur für owner/editor, Reise löschen nur owner, für viewer keine Knöpfe. Ansichtsmodus wie
  `Trip.tsx`: ab dem ersten begonnenen Punkt (Hafentag ab Ankunft, sonst Tagesbeginn; Einträge ab Beginn) gesperrt. Band oben im Ablauf
  „Ansichtsmodus: Die Reise läuft …“ mit „Bearbeiten entsperren“ (Bestätigung), bzw. „Bearbeiten ist aktiv. Bis du die App beendest.“ mit
  „Ansichtsmodus einschalten“. Entsperrt wird nur im Speicher (`AppSession.unlockedTrips`). Quittieren und Reisetag-Abfrage bleiben immer
  möglich.
- **Reisen:** Reiseliste „+“ (oben links) → „Neue Reise“: Titel (Pflicht), Art (Kreuzfahrt / Städtetrip / Rundreise mit Texten der
  Web-App), Beginn/Ende freiwillig → `POST /trips`, danach öffnet sich die neue Reise. Im Ablauf Menü „…“: „Reise bearbeiten“ (Titel, Art,
  Beginn, Ende, Notizen → `PATCH /trips/:id` nur mit geänderten Feldern), „Reise löschen“ (nur owner, Bestätigung nennt den Titel und
  dass Einträge, Kreuzfahrten und Dokumente mit gelöscht werden → `DELETE /trips/:id`, zurück zur Liste).
- **Einträge** (`EditForms.swift` → `ItemFormView`): „+“ im Ablauf. Art-Auswahl (Landausflug nur bei Kreuzfahrt, Station nur sonst),
  Felder wie `ItemForm.tsx`: Titel, Beginn/Ende (Datum, Uhrzeit freiwillig, Zeitzone je Zeitpunkt mit Suche, „Standard“ = leer), Ort/Adresse,
  Anbieter, Buchungsnummer, Preis/Währung/Zahlung/Anzahlung/Fälligkeit, Notizen, Kreuzfahrt-Tag (bei Landausflug, Aktivität, Restaurant,
  Notiz, Transfer), die `details` der Art inkl. Terminal/Schalter/Gate/Kofferband/Gleis, „Gebucht über“ beim Landausflug, Zusatzinfos.
  Im Detail „Bearbeiten“ (gleiches Formular) und „Eintrag löschen“ mit Bestätigung.
  - Speichern neu: `POST /trips/:id/items`; ändern: `PATCH /items/:id` nur mit geänderten Feldern, `details` dann komplett (bisherige
    Schlüssel + geänderte; leeres Feld entfernt den Schlüssel; unbekannte Schlüssel und Zahlenwerte bleiben).
  - Zeiten als Ortszeit-Text (`2027-05-08T09:40` bzw. nur Datum) + IANA-Zone, nie UTC.
  - Währung: neue Einträge mit der zuletzt benutzten Währung dieses Geräts, sonst leer.
  - Zusatzinfos: Art, Bezeichnung, Wert, entfernen, „+ Notruf/Telefon/Hinweis“. `ai`/`web` behalten ihre Quelle, bis Text geändert wird.
- **Kreuzfahrt:** Menü „Kreuzfahrt … bearbeiten“ (Schiff, Reederei, Kabine, Buchungsnummer, Notizen, Preis/Zahlung, Zusatzinfos →
  `PATCH /cruises/:id`), „Reisetag hinzufügen“ (Datum vorbelegt mit letztem Tag + 1 → `POST /cruises/:id/days`). Im Hafentag-Detail
  „Bearbeiten“ (Art, Datum, Zeitzone, Hafen, Land, Ankunft/Check-in ab, Abfahrt bzw. „Von Bord bis“, Alle an Bord, Tender, Notizen,
  Zusatzinfos → `PATCH /cruise-days/:id`) und „Reisetag löschen“ mit Bestätigung. Neue Kreuzfahrt anlegen: nicht in der App (wie im Auftrag).
- **Hinweise quittieren** (war in 0.1.0 noch nicht gebaut, nur angezeigt): je offenem Hinweis „Quittieren“, bei quittierten „Quittierung
  zurücknehmen“ und „quittiert von …“ (`PUT`/`DELETE /trips/:id/warnings/:key/ack`, für owner/editor, auch im Ansichtsmodus). 404 →
  Ablauf neu laden.
- **Nach jedem Speichern/Löschen:** Reise-Detail und Ablauf neu laden; damit Cache, Widget und Erinnerungen am Ort aktualisiert. Reisen
  anlegen/ändern/löschen lädt zusätzlich die Liste.
- **Fehler** im Formular (rote Zeile oben, 400-Text des Servers), nicht als Dialog. **Offline:** Anfrage scheitert → „Offline, Änderung
  nicht gespeichert.“, Formular bleibt offen mit allen Eingaben, keine Warteschlange.
- **Tests** (`ReisebuchTests/EditLogicTests.swift`, neu, 6): details zusammenführen (unbekannte Schlüssel bleiben, leeres Feld entfernt,
  Zahl bleibt Zahl), nur geänderte Felder im PATCH (mit details komplett), Zeit + Datum als Text und DatePicker hin und zurück, Anzahlung
  nur bei „angezahlt“/Fälligkeit nicht bei „bezahlt“/ohne Preis alles leer/Fehlertexte, Ansichtsmodus-Regel inkl. Beginn, Arten je Reiseart.
  **37/37 grün.** Gegenprobe: Zusammenführen ohne bisherige Schlüssel → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- **Zeitzone neuer Einträge:** die Zone des letzten Eintrags im Ablauf, sonst `defaultTimezone`. Wählt man einen Kreuzfahrt-Tag, wird
  dessen Zone übernommen (solange die Vorbelegung nicht geändert wurde). Die Web-App lässt das Feld leer (= Standard); „Standard“ ist in
  der App wählbar.
- **Offline:** Die App versucht immer zu speichern und meldet „Offline …“, wenn der Server nicht erreichbar ist (statt bei sichtbarem Band
  gar nicht zu versuchen). Ergebnis für Philip gleich, aber kein unnötiger Fehlschlag, wenn das VPN inzwischen wieder steht.
- Löschen eines Eintrags im Detail (unten „Eintrag löschen“), nicht im Formular.
- Nach dem Bearbeiten eines Reisetags geht die App zurück zum Ablauf (der den neuen Stand zeigt).
- „Neue Reise“ ohne KI-Import (Dokumente kommen mit 0.7.0).

## Build-Ergebnis
Grün (Debug Simulator, Tests, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log. Verbleibend nur die bekannte Meldung
`appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).
**Keine Prüfung im Simulator** (Philips Entscheidung vom 28.11.2026), nur Build und Unit-Tests. Nicht gesehen habe ich damit alle neuen
Formulare und Knöpfe; bitte bei den Tests unten besonders auf Darstellung und Abläufe achten.

## IPA
- `ios/Installation/0.6.0-b6/Reisebuch-0.6.0-b6.ipa`, 734 749 Bytes, App und Widget je 0.6.0 (6).
- SHA256: `af4dfba6c4ec3d7f39bab114cb565d17a0be8ae9fab6afa4b3cb04f608959d24`
- Profile unverändert: App 22d2bb98… (`aps-environment` = `production`), Widget a8497ea0…, beide 2 Geräte, gültig bis 01.11.2027.
- `project.pbxproj` nach Archiv und Export unverändert.
- IPA noch nicht im Git (wie bei 0.5.0): kommt am Ende von 0.7.0 zusammen in einen Commit.

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (nur Version 0.6.0 / Build 6, 8 Vorkommen je Schlüssel)
- `ios/Reisebuch/Reisebuch/`: neu `EditLogic.swift`, `EditForms.swift`; geändert `APIClient.swift`, `AppSession.swift`, `Models.swift`
  (`TripDetail` mit `trip`, `CruiseSummary` mit Preis, Infos, Tagen), `TripListView.swift`, `TripTimelineView.swift`, `DetailViews.swift`
- `ios/Reisebuch/ReisebuchTests/EditLogicTests.swift` (neu)
- `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- 4f25f1b iOS 0.6.0: Bearbeiten in der App
- folgender Commit: iOS 0.6.0 (6): STAND, Auftrag abgeschlossen

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: Vorbelegung der Zeitzone und Offline-Verhalten (siehe Entscheidungen).

## Was Philip auf dem iPhone testen soll
Vorher: IPA 0.6.0-b6 installieren, App mit VPN öffnen. Am besten mit einer Test-Reise, die du danach löschst.
1. **Neue Reise:** Reiseliste → „+“ oben links → Titel „Test“, Art „Städtetrip“, Beginn/Ende wählen → „Anlegen“. Die Reise öffnet sich
   und steht in der Liste (auch in der Web-App).
2. **Eintrag anlegen:** In der Reise „+“ → Art „Flug“ (Landausflug darf bei Städtetrip nicht in der Liste stehen, Station schon) → Titel,
   Datum, Uhrzeit, Zeitzone (Suche „Rom“), Ende mit Ankunftszone, Von/Nach, Terminal, Gate, Preis mit Währung → „Speichern“. Steht der Flug
   mit richtiger Ortszeit und fett „Terminal … · Gate …“ im Ablauf? In der Web-App gleich?
3. **Ändern:** Flug antippen → „Bearbeiten“ → Gate ändern → „Speichern“. Detail und Ablauf zeigen das neue Gate. Ist ein anderes
   Familienmitglied in der Reise und der Flug höchstens 36 h entfernt: Bekommt es die Mitteilung „Gate … (vorher …)“?
4. **Details bleiben erhalten:** Einen Eintrag, den die KI aus einem Dokument angelegt hat, ändern (z. B. nur Notiz). In der Web-App prüfen,
   dass alle übrigen Angaben (auch solche, die das App-Formular nicht zeigt) noch da sind.
5. **Preis:** Zahlung „angezahlt“ → Feld „Bereits angezahlt“ erscheint; „bezahlt“ → kein Fälligkeitsdatum. Reiter „Kosten“ in der Web-App
   zeigt dasselbe.
6. **Löschen:** Eintrag → unten „Eintrag löschen“ → Bestätigen. Reise → „…“ → „Reise löschen“ (nur als Eigentümer sichtbar) → der Dialog
   nennt den Titel → zurück zur Liste, Reise weg.
7. **Kreuzfahrt** (in einer Kreuzfahrt-Reise): „…“ → „Kreuzfahrt … bearbeiten“ (z. B. Kabine) und „Reisetag hinzufügen“. Hafentag antippen
   → „Bearbeiten“ → „Alle an Bord“ ändern; bei „Ausschiffung“ heißt das Feld „Von Bord bis“.
8. **Quittieren:** Hinweise oben aufklappen → „Quittieren“ → der Hinweis wandert nach „Quittiert“, „Quittierung zurücknehmen“ holt ihn zurück.
9. **Ansichtsmodus:** In einer laufenden Reise ist oben „Ansichtsmodus …“ zu sehen, „+“ und „…“ fehlen, statt dessen ein Schloss.
   „Bearbeiten entsperren“ → Knöpfe da. App ganz schließen und neu öffnen → wieder gesperrt. Quittieren geht auch gesperrt.
10. **Offline:** VPN aus, Eintrag ändern → „Offline, Änderung nicht gespeichert.“, Eingaben bleiben im Formular.
11. Als Mitglied mit Rolle „Ansehen“ (viewer): keine Knöpfe zum Bearbeiten.
