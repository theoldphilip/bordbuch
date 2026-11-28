# STAND (iOS), 28.11.2026

Auftrag: `ios/AUFTRAG-0.8.0.md` (0.8.0, Build 8), erledigt und nach `ios/Auftraege/` verschoben. Danach folgt ohne Rückfrage 0.9.0.
Rückgabe zu 0.7.0 steht in der Git-Historie dieser Datei.

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
- **KI-Status und Rolle** (`AILogic.swift` → `AIFeatures`): Die App merkt sich `GET /ai/status` (`enabled`, `research`, `review`,
  `placeLookup`, `providers`, `model`, offline der letzte Stand) und über `GET /me`, ob das Konto Admin ist. Knöpfe erscheinen wie in der
  Web-App; der Ansichtsmodus sperrt die KI-Knöpfe nicht.
- **Teil A, Reise prüfen** (`TripReviewView.swift`): Knopf „🔍 Prüfen“ im Ablauf (bei `review`). Ohne Ergebnis: Text, was geprüft und was
  **nicht** gesendet wird, „Prüfung starten“ (nur editor) → `POST /trips/:id/review`, danach alle 3 s `GET`, solange `pending` und offen.
  Ergebnis: Zusammenfassung, Zählung („1 Fehler · 2 Warnungen · …“), Funde nach Schwere (Fehler rot, Warnung orange, Hinweis neutral) mit
  Titel, Text, Vorschlag; Einträge/Tage eines Funds sind antippbar (Detail öffnet sich). `stale` → Band „Die Reise wurde seit der Prüfung
  geändert“ und „Neu prüfen“; `failed` → Fehlertext und „Erneut versuchen“. Betrachter sehen nur das gespeicherte Ergebnis.
- **Teil B, Vorschläge bearbeiten** (`DocumentsView.swift` → `DocReviewView`): je Vorschlag „Bearbeiten“ öffnet das Eintragsformular aus
  0.6.0 mit den Daten des Vorschlags; „Fertig“ ersetzt nur die Daten dieses Vorschlags im Speicher (Felder, die das Formular nicht kennt,
  bleiben; `details` verlustfrei), markiert ihn „bearbeitet“, blendet seine Probleme aus und schaltet „Übernehmen“ an. Gesendet wird erst mit
  „Übernehmen“. Vorbelegung jetzt wie `DocReview.tsx` (nur Probleme → überspringen; die Abweichung bei `low` aus 0.7.0 ist
  zurückgenommen). Der Hinweis „Ändern nach dem Übernehmen …“ ist weg.
- **Teil C, Recherche** (Abschnitt „Im Internet ergänzen“ in den Vorschlägen, bei `research` und editor): Link optional (nur http/https),
  „🧭 Reiseverlauf suchen“ (nur bei Kreuzfahrt) bzw. „Lücken füllen“ → `POST …/research` (202), alle 3 s `GET …/research`, solange
  `pending`. Ergebnis: Zusammenfassung, Funde mit Häkchen, Ziel, Feldern, Details, Infos („bitte prüfen“), Reiseverlauf-Tagen und
  antippbaren Quellen; „Ausgewählte übernehmen (n)“ → `…/research/accept` `{ids}`, danach Analyse neu laden (bei bearbeiteten
  Vorschlägen vorher Rückfrage, dass die Änderungen verloren gehen, wie Web); „Verwerfen“ → `…/research/dismiss`. „Was wurde gesucht?“
  aufklappbar. Satz „Funde aus dem Internet sind mit „bitte prüfen“ markiert. Nichts wird ohne „Übernehmen“ gespeichert.“
- **Teil D, mehrere Dateien und Text** (`InputCollector.swift`): „Dokumente“ → „+“ öffnet „Dokumente hinzufügen“ mit Liste und
  Hinzufügen aus Dateien, Fotos, Scannen und **„Text einfügen“** (als `Text.txt`). Ab zwei Einträgen Schalter „Gehören zu einer Buchung
  (zusammen auswerten)“ (vorbelegt an, wenn alles Bilder sind). An: alle mit `POST /trips/:id/attachments`, dann
  `POST /trips/:id/documents/group?background=1` mit den IDs (erste führt). Aus: einzeln mit `?background=1`. **Teilen-Erweiterung**:
  derselbe Schalter ab zwei Dateien, gleiche Vorbelegung, gleicher Ablauf.
- **Teil E, neue Reise mit KI**: „Neue Reise“ zeigt bei `enabled` die Wahl „Aus Dokumenten“ (vorbelegt) / „Von Hand“. Aus Dokumenten:
  Name optional, Art „Automatisch erkennen“ (= `city`), Unterlagen wie Teil D, Knopf „Mit KI aufbauen“: `POST /trips` mit Titel oder
  „Neue Reise“, dann Hochladen, dann öffnet sich die Reise. Scheitert eine Datei, bleibt das Blatt mit Fehler und „Zur Reise“ offen.
  **Name aus dem Vorschlag:** Heißt die Reise noch „Neue Reise“ und liefert eine fertige Analyse `suggestedTripTitle`, setzt die App den
  Namen per `PATCH /trips/:id` (beim Laden der Dokumente der Reise und beim Öffnen der Vorschläge).
- **Teil F, Einstellungen „KI und Dokumente“** (`AISettingsView.swift`, in den Einstellungen verlinkt): für alle der Stand (an/aus,
  Anbieter in Reihenfolge, zuletzt genutztes Modell, welche Funktionen). Nur Admin (`GET /ai/config`): aktive Kette, Hauptanbieter
  (Anbieter ohne Schlüssel gekennzeichnet), Schalter „Ausweich“, „Verbindung testen“ (`POST /ai/check`, je Anbieter ✓/✗ mit Grund), je
  Anbieter Stand („eingerichtet, endet auf …“, Quelle `.env` genannt), Feld API-Schlüssel (`SecureField`), „Prüfen und speichern“ (400 →
  Grund, Feld bleibt gefüllt; Erfolg → Feld leer), „Schlüssel entfernen“ (nur Quelle `settings`, Bestätigung, `key: null`), Modell (leer =
  Standard) mit „Modell speichern“. Hinweis zu Datenbank/Backups/VPN wie Web. **Der Schlüssel wird nirgends gespeichert**, er steht nur im
  Feld (Zustand der Ansicht), bis er gesendet ist.
- **Datenschutz-Sätze:** Die App nannte nirgends einen Anbieter; alle neuen Sätze sagen „an den eingestellten KI-Anbieter“ (auch der
  Satz der Recherche, wo die Web-App noch „Websuche von Anthropic“ schreibt).
- Technik: Die KI-Aufrufe stehen als `extension APIClient` in `AILogic.swift` (nur App), weil `APIClient.swift` mit der Erweiterung geteilt
  ist; dafür sind `send`/`perform`/`pathID` nicht mehr `private`.
- **Tests** (`ReisebuchTests/AILogicTests.swift`, neu, 8; `DocumentTests` an die Web-Vorbelegung angepasst): Sichtbarkeit nach Status und
  Rolle, Sortierung/Farbe/Zählung der Funde, Polling stoppt bei done/failed, Ersetzen der Vorschlagsdaten (Rest unverändert, details
  verlustfrei, Vorschlag ohne Datum öffnet), Bodies von Recherche-Start/-accept und Link-Prüfung, Gruppen-Body und Vorbelegung, Titel nur
  bei „Neue Reise“, Bodies von `PUT /ai/config` (nur der geänderte Teil, `key: null`, leeres Modell = null). **50/50 grün.** Gegenprobe:
  Funde unsortiert und leeres Modell als Text → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- Je Vorschlag ein Schalter „Übernehmen“/„Aktualisieren“ statt der drei Knöpfe der Web-App („Neu anlegen“ trotz Treffer gibt es in der
  App nicht).
- Wird bei „zusammen auswerten“ nur eine Datei angenommen, liest die App sie einzeln (`/analyze`, wartet bis zu einer Minute).
- Recherche-Funde zeigen den betroffenen Hafentag nur als „Hafentag“ (die Web-App nennt Datum und Hafen).

## Build-Ergebnis
Grün für App, Widget, Erweiterung und Tests (Debug Simulator, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log.
Verbleibend nur `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).
**Keine Prüfung im Simulator** (Philips Entscheidung), nur Build und Unit-Tests. Keine der neuen Ansichten ist gesehen.

## IPA
- `ios/Installation/0.8.0-b8/Reisebuch-0.8.0-b8.ipa`, 1 175 937 Bytes, App, Widget und Erweiterung je 0.8.0 (8).
- SHA256: `084f0705295b13225f996e442ab9ec8263d3659c795c17bee13cdf0a31e4b8dc`
- Profile unverändert: App 22d2bb98… (`aps-environment` = `production`), Widget a8497ea0…, Erweiterung c018dd7d…, alle 2 Geräte, gültig
  bis 01.11.2027, App Group nur `group.de.theoldphilip.Reisebuch`. `project.pbxproj` nach Archiv und Export unverändert.
- Im Ordner 0.6.0-b6, 0.7.0-b7, 0.8.0-b8; 0.5.0-b5 entfernt.

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (nur Version 0.8.0 / 8, 10 Vorkommen je Schlüssel)
- `ios/Reisebuch/Reisebuch/`: neu `AILogic.swift`, `TripReviewView.swift`, `InputCollector.swift`, `AISettingsView.swift`; geändert
  `DocumentsView.swift`, `DocumentLogic.swift`, `EditForms.swift`, `APIClient.swift`, `Models.swift`, `AppSession.swift`,
  `TripTimelineView.swift`, `DetailViews.swift`, `SettingsView.swift`
- `ios/Reisebuch/ReisebuchShare/ShareView.swift`
- `ios/Reisebuch/ReisebuchTests/AILogicTests.swift` (neu), `DocumentTests.swift`
- `ios/Installation/`, `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- c12e571 iOS 0.8.0: KI-Funktionen wie in der Web-App
- folgende: STAND 0.8.0, IPA 0.8.0

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: die drei kleinen Abweichungen oben.

## Was Philip auf dem iPhone testen soll
Vorher: IPA 0.8.0-b8 installieren, Server 0.14.0.
1. **Reise prüfen:** In einer Reise oben „🔍 Prüfen“ → „Prüfung starten“ → nach bis zu einer Minute die Funde. Einen Fund mit Eintrag
   antippen → der Eintrag öffnet sich. Einen Eintrag ändern, wieder „🔍 Prüfen“ → Band „Die Reise wurde seit der Prüfung geändert“.
2. **Vorschlag bearbeiten:** Ein Dokument hochladen → „Vorschläge prüfen“ → bei einem Vorschlag „Bearbeiten“ → z. B. Gate ändern →
   „Fertig“ (nichts gespeichert, Vorschlag zeigt „bearbeitet“) → „Übernehmen“ → der Eintrag hat das geänderte Gate.
3. **Recherche:** In den Vorschlägen einer Kreuzfahrt-Buchung „🧭 Reiseverlauf suchen“ (optional mit Link der Reederei) → nach ein bis zwei
   Minuten Funde mit Quelle → Häkchen setzen → „Ausgewählte übernehmen“ → die Vorschläge oben sind ergänzt. „Was wurde gesucht?“ ansehen.
4. **Zusammen auswerten aus Fotos:** „Dokumente“ → „+“ → „Aus Fotos“ → drei Screenshots derselben Buchung → Schalter „Gehören zu einer
   Buchung“ ist an → „Hochladen“ → eine Mitteilung, ein Satz Vorschläge („Zusammen gelesen: …“).
5. **Zusammen aus dem Teilen-Menü:** In Fotos drei Screenshots markieren → Teilen → „Reisebuch“ → Schalter an → Reise → „Hochladen“.
6. **Text einfügen:** „+“ → „Text einfügen“ → kopierte Buchungsmail → „Hochladen“.
7. **Neue Reise aus Dokumenten:** Reiseliste „+“ → „Aus Dokumenten“ → ohne Namen, Art „Automatisch erkennen“ → Unterlagen → „Mit KI
   aufbauen“ → die Reise heißt erst „Neue Reise“; nach der Mitteilung „Dokumente“ bzw. „Vorschläge prüfen“ öffnen → der Name wechselt auf
   den Vorschlag der KI.
8. **KI-Einstellungen:** Einstellungen → „KI und Dokumente“: Stand stimmt? Als Admin „Verbindung testen“ (je Anbieter ✓/✗). Optional einen
   Schlüssel eintragen, „Prüfen und speichern“ → Feld ist danach leer, Stand zeigt „endet auf …“.
