# AUFTRAG-0.8.0.md: KI-Funktionen wie in der Web-App (iOS-Auftrag 8)

Version **0.8.0, Build 8** (Regel 2: App, Widget und Teilen-Erweiterung gleich, 10 Vorkommen je Schlüssel). Philip hat 0.7.0 installiert.
Er vermisst in der App die KI-Funktionen der Web-App. Dieser Auftrag holt sie nach. **Vorbild ist die Web-App** (lesen, nicht ändern):
`<repo>/web/src/components/TripReviewDialog.tsx`, `DocReview.tsx`, `ResearchPanel.tsx`, `AiImportDialog.tsx`, `InputCollector.tsx`,
`<repo>/web/src/aiImport.ts`, `<repo>/web/src/pages/Trips.tsx` (Neue Reise mit KI), `<repo>/web/src/pages/settings/Ai.tsx`.
Vertrag: `<repo>/docs/API.md` „Dokument-Analyse (KI)“ und „KI-Prüfung der ganzen Reise“. Server **0.13.0** (Architekt) bringt
`POST /trips/:id/documents/group?background=1` (202, Mitteilung wie beim einzelnen Hochladen), Server **0.14.0** die Auswahl der KI-Anbieter (Teil F).

Welche Knöpfe erscheinen, richtet sich nach `GET /ai/status` (`enabled`, `research`, `review`, `placeLookup`), wie in der Web-App.
Bearbeiten nur mit Rolle owner/editor; der Ansichtsmodus sperrt die KI-Knöpfe **nicht** (wie Quittieren und Reisetag-Abfrage).

**Keine Prüfung im Simulator** (Philips Entscheidung): nur Build und Unit-Tests, Philip prüft auf dem iPhone.

## Teil 0: Vorher
Trennungsprüfung, `git pull --rebase origin main`, `git config user.email` = noreply. Keine neue Capability.

## Teil A: Reise prüfen
- In der Reise ein Knopf **„🔍 Prüfen“** (bei `review: true`). Öffnet eine Ansicht wie `TripReviewDialog.tsx`:
  - `GET /trips/:id/review`. Kein Ergebnis: Satz, was geprüft wird und was **nicht** gesendet wird (Buchungsnummern, Preise, Telefonnummern,
    Dokumente), Knopf „Prüfung starten“ → `POST` (202), danach alle 3 s `GET`, solange `pending` und die Ansicht offen ist.
  - Ergebnis: Zusammenfassung, `findings[]` nach Schwere (Fehler, Warnung, Hinweis; Farben wie Web), je Fund Titel, Text, Vorschlag.
    Antippen eines Funds mit `itemIds`/`dayIds` öffnet den Eintrag bzw. Tag.
  - `stale: true` → Band „Die Reise wurde seit der Prüfung geändert“ und „Neu prüfen“. `failed` → `error` anzeigen.
  - Starten nur editor; Betrachter sehen das gespeicherte Ergebnis.

## Teil B: Vorschläge vor dem Übernehmen bearbeiten
- In der Vorschlags-Ansicht aus 0.7.0 je Vorschlag **„Bearbeiten“**: dasselbe Formular wie in 0.6.0, gefüllt mit `data` des Vorschlags,
  **ohne zu speichern**. „Fertig“ ersetzt nur `data` dieses Vorschlags im Speicher; gesendet wird erst mit „Übernehmen“ (wie `DocReview.tsx`).
  `details` verlustfrei wie in 0.6.0.
- Vorbelegung übernehmen/überspringen **wie in der Web-App** (`DocReview.tsx`); die Abweichung bei `confidence: low` aus 0.7.0 zurücknehmen.
- Hinweis „Ändern nach dem Übernehmen im Eintrag“ entfällt.

## Teil C: Recherche im Internet
- In der Vorschlags-Ansicht (bei `research: true`, Rolle editor) ein Bereich **„Im Internet ergänzen“** wie `ResearchPanel.tsx`:
  - Art: „Lücken füllen“ (`gaps`) oder, nur bei Kreuzfahrt, „Reiseverlauf suchen“ (`route`); optional ein Link (nur http/https).
  - Start `POST /attachments/:id/research` (202), dann alle 3 s `GET …/research`, solange `pending`.
  - Ergebnis: `summary`, `suggestions[]` mit Quelle (Link antippbar), je Vorschlag ein Häkchen; „Übernehmen“ → `…/research/accept` mit
    `ids`, danach die Analyse neu laden (die Vorschläge oben sind dann ergänzt). „Verwerfen“ → `…/research/dismiss`.
  - „Was wurde gesucht?“ aufklappbar mit `diagnostics` (Suchanfragen, gelesene Seiten, verworfene Funde).
  - Satz: „Funde aus dem Internet sind mit „bitte prüfen“ markiert.“ Nichts wird ohne „Übernehmen“ gespeichert.

## Teil D: Mehrere Dateien und Text, zusammen auswerten
- Beim Hinzufügen in „Dokumente“ (0.7.0) zusätzlich **„Text einfügen“** (mehrzeiliges Feld, z. B. kopierte Buchungsmail) → als `Text.txt`.
- Werden **mehrere** Dateien auf einmal gewählt (Dateien oder Fotos), ein Schalter **„Gehören zu einer Buchung (zusammen auswerten)“** wie
  `InputCollector.tsx`. An: alle mit `POST /trips/:id/attachments` hochladen, dann `POST /trips/:id/documents/group?background=1` mit den IDs
  (erste führt). Aus: jede einzeln wie bisher mit `?background=1`. Antwort 202: „Wird gelesen …“ wie bisher.
- Dasselbe in der **Teilen-Erweiterung**: bei mehr als einer Datei derselbe Schalter (Vorbelegung an bei mehreren Bildern, sonst aus).

## Teil E: Neue Reise mit KI
- In der Reiseliste bei „Neue Reise“ (0.6.0) zwei Wege wie `Trips.tsx`: **„Von Hand“** (wie bisher) und **„Aus Dokumenten“** (bei
  `enabled: true`, dann Vorbelegung): Name optional, Reiseart „automatisch“ (= `city`, der Server macht daraus Kreuzfahrt bzw. Rundreise),
  Dateien/Fotos/Scannen/Text, Schalter „zusammen auswerten“. Anlegen `POST /trips` mit Titel oder „Neue Reise“, dann Hochladen wie Teil D.
- Ohne Namen: Sobald die erste Analyse `done` ist und `suggestedTripTitle` liefert und der Titel noch „Neue Reise“ lautet, Titel per
  `PATCH /trips/:id` setzen (wie Web). Prüfen beim Laden der Dokumente der Reise und beim Öffnen der Vorschläge.

## Teil F: Einstellungen „KI und Dokumente“ (Claude, ChatGPT, Gemini)
Seit Server **0.14.0** gibt es drei KI-Anbieter mit Hauptanbieter und Ausweich. Vorbild: `<repo>/web/src/pages/settings/Ai.tsx`,
Vertrag: `<repo>/docs/API.md` (`/ai/status`, `/ai/check`, `/ai/config`).
- Für alle: Status aus `/ai/status` (an/aus, `providers` in Reihenfolge, z. B. „Claude → ChatGPT“; welche Funktionen: Dokumente,
  Recherche, Prüfen, Reisetag-Abfrage).
- Nur Admin (`user.isAdmin`), aus `GET /ai/config`:
  - Hauptanbieter (Auswahl, „(kein Schlüssel)“ kennzeichnen) und Schalter **„Ausweich“** → `PUT /ai/config {primary}` bzw. `{fallback}`.
  - Je Anbieter: Stand („eingerichtet, endet auf abcd“, Quelle `.env` nennen), Feld **API-Schlüssel** als `SecureField`, Knopf
    „Prüfen und speichern“ → `PUT /ai/config {providers: {<id>: {key}}}` (400 = Grund anzeigen, Feld bleibt gefüllt), „Schlüssel entfernen“
    (nur bei Quelle `settings`, Bestätigung) → `{key: null}`, Modell (leer = Standard) → `{model}`. Das Schlüsselfeld nach Erfolg leeren.
  - **Der Schlüssel nie speichern** (nicht in `UserDefaults`, nicht im Schlüsselbund, nicht im Cache, nicht im Log); er steht nur im Feld,
    bis er gesendet ist. Hinweis aus der Web-App übernehmen (Datenbank, Backups, nur über VPN oder HTTPS eingeben).
  - „Verbindung testen“ → `POST /ai/check`, je Anbieter eine Zeile mit ✓/✗ und Grund.
- Datenschutz-Sätze der App („… an die Claude-API“) neutral formulieren: „an den eingestellten KI-Anbieter“ (wie Web 0.14.0).

## Teil G: Prüfen
- Build grün für alle Targets, keine Warnungen (auch Archiv-Log).
- Unit-Tests: Sichtbarkeit der Knöpfe nach `ai/status` und Rolle, Sortierung/Farbe der Funde, Polling stoppt bei `done`/`failed`,
  Ersetzen von `data` eines Vorschlags (andere unverändert, `details` verlustfrei), Vorbelegung wie Web, Body von `research/accept` und
  `documents/group`, Titel-Übernahme nur bei „Neue Reise“, Bodies von `PUT /ai/config` (nur geänderte Teile, `key: null` beim Entfernen). Gegenprobe.
- **IPA ist freigegeben** nach `ios/Installation/0.8.0-b8/`, letzte drei behalten, Profile wie bisher.
- `STAND.md` mit „Was Philip testen soll“ (Reise prüfen, Vorschlag bearbeiten, Recherche, drei Screenshots zusammen auswerten aus Fotos und
  aus dem Teilen-Menü, neue Reise aus Dokumenten mit automatischem Namen, KI-Test), „Neu in 0.8.0“ in `ios/CLAUDE.md`, Auftrag nach
  `ios/Auftraege/`, committen, pull, push.
