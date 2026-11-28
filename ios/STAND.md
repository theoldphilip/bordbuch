# STAND (iOS), 28.11.2026

Auftrag: `ios/AUFTRAG-0.7.0.md` (0.7.0, Build 7), erledigt und nach `ios/Auftraege/` verschoben. Damit ist die Reihe 0.5.0 bis 0.7.0
fertig. Rückgaben zu 0.5.0 und 0.6.0 stehen in der Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. `git config user.email` → `noreply@anthropic.com`.

## Teil 0: Target (von Philip angelegt), Prüfung
- Neues Target **ReisebuchShare** (Share Extension, in Reisebuch eingebettet), Bundle-ID `de.theoldphilip.Reisebuch.ReisebuchShare`,
  Deployment Target iOS 26.2 wie die App, Team wie die App.
- `ReisebuchShare/ReisebuchShare.entitlements`: nur die App Group `group.de.theoldphilip.Reisebuch`. App- und Widget-Entitlements
  unverändert. `grep -ri GymNative ios/Reisebuch` leer.
- Von mir angeglichen: Version/Build der Erweiterung (Xcode: 1.0 / 1) auf 0.7.0 / 7, Gerätefamilie nur iPhone (Xcode: iPhone und iPad).
  Jetzt **10 Vorkommen** je Schlüssel (`MARKETING_VERSION = 0.7.0`, `CURRENT_PROJECT_VERSION = 7`), App, Widget und Erweiterung gleich.
- Von mir im Projekt: Ausnahme im synchronisierten Ordner `Reisebuch/` für das Target ReisebuchShare (wie `WidgetStand.swift` beim Widget):
  `APIClient.swift`, `DocumentLogic.swift`, `Keychain.swift`, `Models.swift` gehören auch zur Erweiterung. Diese Typen sind deshalb
  `nonisolated` (die Erweiterung hat keine MainActor-Vorgabe). `APNsStatus`/`PushTestResponse` sind dafür von `Push.swift` nach
  `Models.swift` gezogen.
- Aktivierungsregel der Erweiterung: statt `TRUEPREDICATE` (Xcode-Warnung) Anhänge/Dateien/Bilder je bis 10 und Text.

## Was ich getan habe
- **Teil A, Anmeldung teilen** (`Keychain.swift`): Token im Schlüsselbund mit `kSecAttrAccessGroup` = `group.de.theoldphilip.Reisebuch`.
  Beim Start `Keychain.migrate()`: liegt das Token noch in der alten Gruppe, wird es in die App-Group-Gruppe kopiert und der alte
  Eintrag gelöscht (Philip bleibt angemeldet). Meldet `SecItemAdd` `-34018`, bleibt der alte Eintrag und gilt weiter; die Einstellungen
  zeigen dann rot „Teilen-Erweiterung: Die Anmeldung ließ sich nicht freigeben (Schlüsselbund-Gruppe fehlt, -34018)“ (dann bitte melden:
  es bräuchte die Capability Keychain Sharing). Server-Adresse und Anzeigename zusätzlich in `UserDefaults(suiteName: group…)`
  (`SharedStore`), nie das Token. Abmelden löscht beides.
- **Teil B, Dokumente in der App** (`DocumentsView.swift`): Im Ablauf oben „Dokumente (n)“ mit Hinweis „… mit Vorschlägen zum Prüfen“ /
  „… wird gelesen“ → Liste (neueste oben, `grouped` ausgeblendet): Dateiname, Datum, zugeordneter Eintrag, Status („Wird gelesen …“,
  „Vorschläge prüfen“, „Nicht gelesen: …“, „Übernommen“). Liegt etwas auf `pending`, lädt die Liste alle 5 s neu, solange sie offen ist.
  Antippen: mit Token laden, in eigenen temporären Ordner, Quick Look (Teilen aus Quick Look möglich), Ordner beim Schließen gelöscht.
  „+“ (Bearbeiter, nicht im Ansichtsmodus): aus Dateien (mehrere), aus Fotos (bis 10, als JPEG), Scannen (`VNDocumentCameraViewController`,
  als PDF „Scan <Datum>.pdf“). Hochladen mit `POST /trips/:id/documents?background=1`: 202 → „Wird gelesen. Du bekommst eine Mitteilung,
  wenn die Vorschläge bereit sind.“, 201 → „Gespeichert.“ Löschen: nach links wischen, Bestätigung, `DELETE /attachments/:id`.
  `NSCameraUsageDescription` = „Zum Scannen von Reiseunterlagen.“
- **Teil C, Vorschläge prüfen** (`DocReviewView`): Art und Zusammenfassung, Warnungen, je Vorschlag Art, Titel, Zeit, Ort, Ortsfelder
  fett, Preis, Sicherheit (sicher/prüfen/unsicher), Probleme rot, bei `match` „Aktualisiert: …“ mit Änderungen. Kreuzfahrt-Vorschlag mit
  Schiff, Kabine, Zahl der Tage und „… Tage werden ergänzt, … kommen neu dazu“. Je Vorschlag ein Schalter „Übernehmen“/„Aktualisieren“
  (Kreuzfahrt „Anlegen“/„Zusammenführen“); vorbelegt an, außer bei Problemen oder `confidence: low`. „Übernehmen“ → `POST …/apply`
  (create/update mit `itemId`/skip, `data` unverändert, Kreuzfahrt create/update mit `cruiseId`/skip), danach Ablauf neu laden (Cache,
  Widget, Orte). „Verwerfen (Datei bleibt)“ → `…/dismiss`. „Erneut lesen“ → `…/analyze` mit Fortschritt (bis 2 min Zeitlimit). Hinweis
  „Ändern nach dem Übernehmen im Eintrag. Web-Recherche und „zusammen auswerten“ gibt es in der Web-App.“
- **Mitteilung antippen** mit `documentId`: Reise öffnen (wie bisher über `url`), dort öffnen sich die Vorschläge dieses Dokuments.
- **Teil D, Teilen-Erweiterung** (`ReisebuchShare/ShareViewController.swift`, `ShareView.swift`): SwiftUI im Host-Controller. Sammelt
  PDF, Bilder (bis 10; HEIC wird JPEG), Dateien (z. B. `.eml`, MIME `message/rfc822`) und Text (als `Text.txt`) einzeln als temporäre
  Dateien; größer als 25 MB wird vorher abgelehnt. Liste der Reisen mit Rolle owner/editor (laufende/kommende oben, „Vergangen“
  eingeklappt), oben „Neue Reise …“ (Titel → `POST /trips`, Art „city“ wie der KI-Start der Web-App, wird beim Übernehmen einer
  Kreuzfahrt zur Kreuzfahrt). „Hochladen“ je Datei mit `?background=1`, Body aus der Datei gestreamt (`URLSession.upload(fromFile:)`).
  Ergebnis „Wird gelesen, du bekommst eine Mitteilung.“ bzw. „Gespeichert.“, dann schließt sie (`completeRequest`). Nicht angemeldet:
  „Bitte zuerst in der App anmelden.“ Server nicht erreichbar: „Server nicht erreichbar (VPN an?).“, nicht hochgeladene Dateien bleiben,
  Erweiterung bleibt offen. Sie liest nur Token und Server-Adresse aus der App Group.
- **Tests** (`ReisebuchTests/DocumentTests.swift`, neu, 5): Vorbelegung (low und Probleme → überspringen) und apply-Body (create/update/
  skip, Kreuzfahrt update/skip/null, `data` unverändert inkl. Zahl), Status-Texte und Sichtbarkeit/Reihenfolge, `documentId` aus
  `userInfo`, Mehrteil-Body (Dateiname bereinigt, MIME, Inhalt gestreamt) und 202/201, Umzug des Tokens mit Test-Schlüsselbund (umziehen,
  zweiter Start, leer, `-34018` lässt alles stehen, Speichern ohne Berechtigung, Abmelden). **42/42 grün.** Gegenprobe: `low` wird
  übernommen und alter Eintrag bleibt beim Umzug → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- Vorbelegung „überspringen“ auch bei `confidence: low` (wie im Auftrag; die Web-App übernimmt dort).
- „Optional an einen Eintrag hängen“ (`?itemId=` aus dem Eintrags-Detail) nicht gebaut; der Server ordnet die Datei beim Übernehmen dem
  ersten angelegten/aktualisierten Eintrag zu.
- Ob 0.12.0 auf der Synology läuft, prüft die App nicht eigens. Läuft eine ältere Version, antwortet der Server ohne `background` mit 201
  nach der Analyse (dann „Gespeichert.“ und die Vorschläge stehen gleich in der Liste).
- Neue Reise aus der Erweiterung mit Art „Städtetrip“; der Server macht daraus beim Übernehmen einer Kreuzfahrt eine Kreuzfahrt.

## Build-Ergebnis
Grün für App, Widget, Erweiterung und Tests (Debug Simulator, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log.
Verbleibend nur die bekannte Meldung `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).
**Keine Prüfung im Simulator** (Philips Entscheidung vom 28.11.2026), nur Build und Unit-Tests. Nicht gesehen: Dokumentenliste, Quick Look,
Scanner, Fotos-Auswahl, Vorschläge-Ansicht, Teilen-Erweiterung, Umzug des Tokens auf dem Gerät.

## IPA
- `ios/Installation/0.7.0-b7/Reisebuch-0.7.0-b7.ipa`, 988 645 Bytes, App, Widget und Erweiterung je 0.7.0 (7).
- SHA256: `8be6a81c48535f597560180c46fdcffe08c3cdcef112c8870f8ef9bf4489e944`
- Profile:
  - App „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch“ unverändert (22d2bb98…), `aps-environment` = `production`
    (auch in der signierten App), App Group nur `group.de.theoldphilip.Reisebuch`.
  - Widget unverändert (a8497ea0…).
  - **Neu:** „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch.ReisebuchShare“ (c018dd7d…), App Group nur
    `group.de.theoldphilip.Reisebuch`, kein Push. Alle 2 Geräte, gültig bis 01.11.2027.
- `project.pbxproj` nach Archiv und Export unverändert.
- Im Ordner jetzt 0.5.0-b5, 0.6.0-b6, 0.7.0-b7 (letzte drei); 0.2.0-b2, 0.3.0-b3, 0.4.0-b4 entfernt (über Git erreichbar).
- Die drei IPAs (0.5 bis 0.7) stehen im eigenen Commit 7c1d762 (gepusht).

| Version | SHA256 |
|---|---|
| 0.5.0-b5 | `feda0e3c9287b4e8b86f3fd56fe862a421785806afc329e36be39b4c8bb90196` |
| 0.6.0-b6 | `af4dfba6c4ec3d7f39bab114cb565d17a0be8ae9fab6afa4b3cb04f608959d24` |
| 0.7.0-b7 | `8be6a81c48535f597560180c46fdcffe08c3cdcef112c8870f8ef9bf4489e944` |

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (Target ReisebuchShare von Philip; ich: Version 0.7.0 / 7 überall, Gerätefamilie,
  Ausnahme für gemeinsame Dateien)
- `ios/Reisebuch/Reisebuch/`: neu `DocumentLogic.swift`, `DocumentsView.swift`; geändert `Keychain.swift` (Gruppe, Umzug, `SharedStore`),
  `APIClient.swift` (Dokument-Aufrufe, Hochladen, längeres Zeitlimit), `Models.swift`, `AppSession.swift`, `Push.swift`,
  `TripTimelineView.swift`, `SettingsView.swift`, `Info.plist` (Kamera)
- `ios/Reisebuch/ReisebuchShare/` (Vorlage von Xcode ersetzt: `ShareViewController.swift`, neu `ShareView.swift`, `Info.plist`)
- `ios/Reisebuch/ReisebuchTests/DocumentTests.swift` (neu)
- `ios/Installation/`, `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- 27cfe3e iOS 0.5.0: Erinnerungen am Ort · 8427861 STAND 0.5.0
- 4f25f1b iOS 0.6.0: Bearbeiten in der App · 6fbe655 STAND 0.6.0
- 0a3926b iOS 0.7.0: Dokumente und Teilen-Erweiterung
- 19b11b2 STAND 0.7.0 · 7c1d762 IPAs 0.5.0 bis 0.7.0

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: `confidence: low` vorbelegt als überspringen (Abweichung zur Web-App, wie bestellt); Anhängen an einen
  Eintrag aus dem Detail nicht gebaut.

## Was Philip auf dem iPhone testen soll
Vorher: IPA 0.7.0-b7 installieren (enthält 0.5 und 0.6). Server 0.12.0 muss laufen (Einstellungen → Versionen → Server).
1. **Angemeldet bleiben:** Nach dem Update öffnet die App ohne neue Anmeldung. In den Einstellungen unter „Anmeldung“ steht **keine** rote
   Zeile „Teilen-Erweiterung …“ (sonst Screenshot).
2. **Teilen aus Mail:** Eine Buchungsmail öffnen → PDF-Anhang lange drücken → Teilen → „Reisebuch“ (ggf. unter „Mehr“ einschalten).
   Die Erweiterung zeigt die Datei und deine Reisen. Reise wählen → „Hochladen“ → „Wird gelesen, du bekommst eine Mitteilung.“ → schließt.
   Ebenso eine Datei aus der Dateien-App und einen markierten Text.
3. **Mitteilung abwarten** (bis etwa 1 Minute): „📄 Dokument gelesen: n Vorschläge zum Prüfen“. Antippen → die Reise öffnet sich, darüber
   die Vorschläge. Schalter ansehen (unsichere/mit Problem sind aus), „Übernehmen“ → Einträge stehen im Ablauf.
4. **Neue Reise aus dem Teilen-Menü:** „Neue Reise …“ → Name → „Anlegen“ → sie ist gewählt → „Hochladen“.
5. **In der App:** Reise → „Dokumente“ → Datei antippen → Quick Look zeigt sie. „+“ → „Scannen“ (Kamera-Erlaubnis) → Seiten scannen →
   „Sichern“ → „Wird gelesen …“ in der Liste, wechselt von selbst auf „Vorschläge prüfen“. „+“ → „Aus Fotos“ mit einem Foto einer Buchung.
6. **Verwerfen / Erneut lesen** in den Vorschlägen ausprobieren; Löschen eines Dokuments durch Wischen nach links.
7. **Offline:** VPN aus, aus Mail teilen → „Server nicht erreichbar (VPN an?).“, „Erneut versuchen“ nach VPN an.
8. **Abmelden** in der App → Teilen zeigt „Bitte zuerst in der App anmelden.“
Aus 0.5.0 und 0.6.0 gelten zusätzlich die Testschritte in der Git-Historie dieser Datei (Erinnerungen am Ort, Bearbeiten).
