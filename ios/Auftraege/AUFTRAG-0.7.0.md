# AUFTRAG-0.7.0.md: Dokumente und Teilen-Erweiterung (iOS-Auftrag 7)

Version **0.7.0, Build 7** (Regel 2: App, Widget **und** die neue Teilen-Erweiterung gleich). Dritter von drei Aufträgen (siehe Kopf von
`AUFTRAG-0.5.0.md`): erst beginnen, wenn 0.6.0 gepusht ist.

Server **0.12.0** (Architekt) bringt dafür `POST /trips/:id/documents?background=1`: sofort 202, Auswertung im Hintergrund, danach eine
Mitteilung mit `documentId` (API.md „Dokument-Analyse (KI)“ und „iPhone-App (APNs)“). Ob 0.12.0 auf der Synology läuft, zeigt
`GET /api/version`.

## Teil 0: Vorher
1. Trennungsprüfung, `git pull --rebase origin main`, `git config user.email` = noreply.
2. **Philip** legt das neue Target an (Regel 5). Anleitung geben, auf „fertig“ warten:
   - *File → New → Target… → Share Extension*, Name **`ReisebuchShare`**, Sprache Swift, Embed in **Reisebuch**. Bundle-ID wird
     `de.theoldphilip.Reisebuch.ReisebuchShare`. Frage „Activate scheme?“ → *Activate*.
   - Beim Target **ReisebuchShare**: *Signing & Capabilities* → Team wie die App → *+ Capability* → **App Groups** → Häkchen nur bei
     **`group.de.theoldphilip.Reisebuch`**. Nichts sonst (kein Push, keine Background Modes).
3. Prüfen und in `STAND.md`: Bundle-ID, Deployment Target wie die App (iOS 26.2), App Group nur `group.de.theoldphilip.Reisebuch`,
   Version/Build wie App und Widget (Zahl der Vorkommen je Schlüssel neu zählen und nennen), `grep -ri GymNative ios/Reisebuch` leer.

## Teil A: Anmeldung teilen (App und Erweiterung)
- Die Erweiterung braucht Server-Adresse und Token. **Token:** im Schlüsselbund mit `kSecAttrAccessGroup` = App Group
  (`group.de.theoldphilip.Reisebuch`; App Groups gelten unter iOS als Keychain-Zugriffsgruppe). Beim ersten Start von 0.7.0 das vorhandene
  Token einmal in die Gruppe umziehen (lesen, in der Gruppe speichern, alten Eintrag löschen), damit Philip sich nicht neu anmelden muss.
  Meldet `SecItemAdd` `errSecMissingEntitlement` (-34018): **aufhören und fragen** (dann braucht es die Capability Keychain Sharing).
- **Server-Adresse** und Anzeigename zusätzlich in `UserDefaults(suiteName: "group.de.theoldphilip.Reisebuch")`. Kein Token in
  `UserDefaults`, nirgends im Klartext.
- Abmelden löscht beides wie bisher.

## Teil B: Dokumente in der App
- In der Reise ein Bereich **„Dokumente“** (aus `attachments[]` von `GET /trips/:id`, neueste oben): Dateiname, Datum, zugeordneter
  Eintrag, Status aus `analysisStatus`: `pending` „Wird gelesen …“, `done` „Vorschläge prüfen“, `failed` „Nicht gelesen“ + `analysisError`,
  `applied` „Übernommen“, `dismissed`/`null` nichts, `grouped` ausblenden. Liegt etwas auf `pending`, alle 5 s neu laden, solange sichtbar.
- Antippen einer Datei: mit Token laden (`GET /attachments/:id`), in einen temporären Ordner, mit **Quick Look** zeigen; Teilen aus Quick
  Look erlaubt. Temporäre Dateien beim Schließen löschen.
- **Hinzufügen** (Rolle editor, nicht im Ansichtsmodus gesperrt): aus *Dateien*, aus *Fotos* (`PhotosPicker`) oder **Scannen**
  (`VNDocumentCameraViewController`, als PDF). `Info.plist`: `NSCameraUsageDescription` = „Zum Scannen von Reiseunterlagen.“ Hochladen
  mit `POST /trips/:id/documents?background=1` (Feld `file`, echter Dateiname, MIME-Typ). Antwort 202: „Wird gelesen. Du bekommst eine
  Mitteilung, wenn die Vorschläge bereit sind.“ 201 mit `analyzable: false` oder `aiEnabled: false`: „Gespeichert.“
  Optional an einen Eintrag hängen (`?itemId=` beim Hochladen aus dem Detail eines Eintrags).
- Löschen (editor): Bestätigung, `DELETE /attachments/:id`.

## Teil C: Vorschläge prüfen
- „Vorschläge prüfen“ öffnet `GET /attachments/:id/analysis`: Art und Zusammenfassung, Warnungen, je Vorschlag Titel, Art, Zeiten,
  Ort, Preis, Ortsfelder, Sicherheit (`confidence`), `problems[]` (rot), bei `match` „Aktualisiert: <Titel>“ mit `changes[]`. Dazu der
  Kreuzfahrt-Vorschlag (`cruise`: neue/aktualisierte Tage).
- Je Vorschlag ein Schalter **übernehmen / überspringen** (Vorbelegung wie `DocReview.tsx`: übernehmen, außer bei `problems` oder
  `confidence: low`). Bearbeiten der Vorschläge vor dem Übernehmen **nicht** in der App (dafür gibt es nach dem Übernehmen das Formular aus
  0.6.0); Hinweis „Ändern nach dem Übernehmen im Eintrag.“
- **„Übernehmen“** → `POST /attachments/:id/apply` mit `items[]` (`create` ohne `match`, `update` mit `itemId` aus `match`, `skip`; `data`
  unverändert aus der Analyse) und `cruise` entsprechend. Danach Ablauf neu laden (Cache, Widget, Orte).
- **„Verwerfen“** → `POST /attachments/:id/dismiss` (Datei bleibt). **„Erneut lesen“** → `POST /attachments/:id/analyze` (dauert bis
  1 Minute, Fortschritt zeigen).
- Web-Recherche und „zusammen auswerten“ bleiben in der Web-App; Satz dazu in der Ansicht.
- **Mitteilung antippen** mit `userInfo["documentId"]`: Reise öffnen (bisheriger Weg über `url`) und dort die Vorschläge dieses Dokuments.
  Ohne `documentId` wie bisher nur die Reise.

## Teil D: Teilen-Erweiterung `ReisebuchShare`
- Annehmen (`NSExtensionActivationRule`): PDF, Bilder (bis 10), Dateien (z. B. `.eml`), Text. Text wird als `Text.txt` hochgeladen.
- Oberfläche (SwiftUI im Host-Controller): Liste der Reisen aus `GET /trips` (laufende und kommende oben, „Vergangen“ eingeklappt), nur
  Reisen mit Rolle owner/editor; oben **„Neue Reise …“** (Titel eingeben → `POST /trips`). Knopf **„Hochladen“**.
- Hochladen je Datei mit `POST /trips/:id/documents?background=1`. Ergebnis: „Wird gelesen, du bekommst eine Mitteilung.“ bzw.
  „Gespeichert.“; Fehler im Klartext. Danach schließen (`completeRequest`). Nicht angemeldet: „Bitte zuerst in der App anmelden.“ Server
  nicht erreichbar: „Server nicht erreichbar (VPN an?).“, nichts verloren, Erweiterung bleibt offen.
- Speicher der Erweiterung ist knapp: Dateien streamen bzw. einzeln laden, nichts doppelt im Speicher. Größer als 25 MB: vorher ablehnen.
- Keine weiteren Rechte, kein Zugriff auf andere Daten der App außer App Group (Token, Server-Adresse).

## Teil E: Prüfen
- Build grün für App, Widget, Erweiterung, Tests; keine Warnungen (auch Archiv-Log).
- Unit-Tests: Auswahl übernehmen/überspringen und Aufbau des `apply`-Bodys (create/update/skip, cruise), Status-Texte, Erkennung von
  `documentId` im `userInfo`, Mehrteil-Body (Dateiname, MIME-Typ), Umzug des Tokens (mit Test-Schlüsselbund oder abstrahiert). Gegenprobe.
- **Keine Prüfung im Simulator** (Philips Entscheidung vom 28.11.2026): keine Klick-Tests, kein Beispielserver, keine UI-Tests. Build und
  Unit-Tests bleiben Pflicht. Philip prüft auf dem iPhone; deshalb `STAND.md` → „Was Philip testen soll“ besonders genau.
- **IPA ist freigegeben** nach `ios/Installation/0.7.0-b7/`, letzte drei behalten. Profile in `STAND.md`: App (`aps-environment`
  `production`), Widget, **neu** Erweiterung (Name, App Group). `project.pbxproj` nach dem Export unverändert.
- `STAND.md` („Was Philip testen soll“: Teilen einer Buchungsmail/PDF aus Mail oder Dateien, Mitteilung abwarten, Vorschläge übernehmen;
  Scannen; App bleibt nach Update angemeldet), „Neu in 0.7.0“ in `ios/CLAUDE.md` (Targets um `ReisebuchShare` ergänzen), Auftrag nach
  `ios/Auftraege/`, committen, pull, push.
