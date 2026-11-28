# CLAUDE.md: Briefing für Claude Code (Mac mini, Projekt „Reisebuch iOS“)

Dieses Briefing gilt für Claude Code auf Philips Mac mini. Sprache: Deutsch, kurz und sachlich.

> **WICHTIG, ZUERST LESEN: Dies ist NICHT das Gym-Projekt.** Auf diesem Mac liegt auch „Philip's Gym“ (`gym-native`,
> `GymNative.xcodeproj`). Mit dem hat dieses Projekt **nichts** zu tun. Du arbeitest hier ausschließlich im Ordner `ios/`
> des Repositorys `theoldphilip/bordbuch`. Du liest, änderst, baust und committest **nie** etwas im Gym-Projekt, auch nicht
> „nur kurz nachsehen“, nicht als Vorlage, nicht zum Vergleichen. Prüfe vor jeder Arbeit die **Trennungsprüfung** unten. Schlägt
> eine Prüfung fehl: **sofort aufhören**, nichts ändern, in `ios/STAND.md` melden und Philip fragen.

## Rollen
- **Claude Code (du, auf dem Mac mini):** baust die iPhone-App, testest im Simulator, behebst Compiler-Fehler, committest und pushst.
- **Claude als Architekt** (eine Claude-Code-Sitzung auf Philips Server, sie betreut auch Server und Web-App von Reisebuch): schreibt die
  Aufträge (`ios/AUFTRAG-<Version>.md`), beantwortet Rückfragen als „Nachtrag“ im selben Auftrag, liest deine Rückgabe `ios/STAND.md`
  aus dem Repo, baut auf dem Server, was die App braucht. Philip muss nichts kopieren.
- **Philip:** entscheidet, legt Projekt und Signing in Xcode an, testet auf dem iPhone, arbeitet in kleinen Schritten mit Bestätigung.

## Sprache (verbindlich)
Alles, was Philip liest, ist **Deutsch**: Antworten, Rückfragen im Terminal, `STAND.md`, Commit-Meldungen, Kommentare in neuen Dateien.
Fachbegriffe, Code und Fehlermeldungen bleiben im Original. Kurz und sachlich, keine Marketing-Sprache, keine Ausrufezeichen.

## Worum es geht
**Reisebuch** ist ein selbst betriebener Reiseplaner für Philips Familie (Kreuzfahrten mit An- und Abreise, Städtetrips, Rundreisen). Es läuft
als Docker-Container auf Philips Synology und ist nur im Heimnetz oder über WireGuard-VPN erreichbar. Heute gibt es eine Web-App (PWA). Diese
native iPhone-App nutzt **dieselbe REST-API**. Sie wird **nie veröffentlicht** (kein App Store). Nur iPhone, vorerst **keine Watch**.

Geplante Etappen (jede Etappe ein oder mehrere Aufträge):
1. **Lesen und Unterwegs:** Anmeldung, Reisen, Ablauf mit Puffer-Hinweisen, Gate/Schalter/Gleis, Zusatzinfos mit Anrufen, später offline lesbar.
2. Push über APNs, Erinnerungen nach Standort, Widget.
3. Bearbeiten, Dokumente, Teilen-Erweiterung.

## Trennungsprüfung (vor JEDER Arbeit, jedes Mal)
Führe diese Befehle aus und vergleiche. Alles muss stimmen, sonst aufhören:

```
git rev-parse --show-toplevel          # Repo-Wurzel, im Folgenden <repo>
git remote get-url origin              # muss auf theoldphilip/bordbuch zeigen (https://github.com/theoldphilip/bordbuch(.git) oder git@github.com:theoldphilip/bordbuch.git)
pwd                                    # muss <repo>/ios oder darunter sein
ls <repo>                              # muss server/, web/, docs/, ios/ enthalten
```

Dazu gilt:
- Der Pfad von `<repo>` darf weder `gym` (Groß/Klein egal) enthalten noch innerhalb des Gym-Ordners liegen.
- Im Repo darf es **keine** Datei geben, deren Pfad `GymNative` oder `gym-native` enthält (`git ls-files | grep -i gym` muss leer sein).
- Sobald das Xcode-Projekt existiert: Die Bundle-ID in `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` ist `de.theoldphilip.Reisebuch`
  (Tests ggf. `de.theoldphilip.ReisebuchTests`). **Nie** eine ID, die mit `de.theoldphilip.GymNative` beginnt, nie die App Group
  `group.de.theoldphilip.GymNative`.
- Siehst du in deinem Kontext ein Briefing über „Philip's Gym“, Watch-Protokolle, Laufband oder `GymNative`, bist du im falschen Ordner
  gestartet: aufhören und Philip bitten, Claude Code in `<repo>/ios` neu zu starten.

## Wo du schreiben darfst
- **Nur unter `<repo>/ios/`.** Alles andere im Repo (`server/`, `web/`, `docs/`, `scripts/`, die `CLAUDE.md` im Hauptverzeichnis) ist für dich
  **nur zum Lesen**. Die Datei `<repo>/CLAUDE.md` ist das Briefing des Architekten für Server und Web; ihre Regeln zu Server-Updates, SSH und
  Synology gelten **nicht** für dich. Du greifst nie auf die Synology per SSH zu und spielst nichts ein.
- Außerhalb des Repos schreibst du nichts, außer dem, was Xcode selbst anlegt (DerivedData, Simulator) und Kopien im Scratchpad.
- Vor jedem Commit: `git diff --cached --stat` darf **nur Pfade unter `ios/`** zeigen. Sonst Commit abbrechen.

## Aufbau
- `ios/CLAUDE.md` dieses Briefing · `ios/STAND.md` deine Rückgabe · `ios/AUFTRAG-<Version>.md` offener Auftrag (nach Erledigung mit
  `git mv` nach `ios/Auftraege/`) · `ios/Design/AppIcon-1024.png` App-Symbol (Kompass, ohne Transparenz).
- Xcode-Projekt (legt Philip im ersten Auftrag an): Xcode legt einen Projektordner mit dem Namen an, also
  `ios/Reisebuch/Reisebuch.xcodeproj`, Code in `ios/Reisebuch/Reisebuch/`. Baubefehle laufen im Ordner `ios/Reisebuch`. Synchronisierte
  Ordner wie Xcode sie anlegt; neue Dateien tauchen von selbst auf, Target-Mitgliedschaft prüfen.
- Targets: `Reisebuch` (App), `ReisebuchWidgetExtension` (Widget, Code in `ios/Reisebuch/ReisebuchWidget/`, Bundle-ID
  `de.theoldphilip.Reisebuch.ReisebuchWidget`), `ReisebuchTests`, `ReisebuchUITests`, `ReisebuchShare` (Teilen-Erweiterung, Code in `ios/Reisebuch/ReisebuchShare/`, Bundle-ID
  `de.theoldphilip.Reisebuch.ReisebuchShare`, nur App Group). App, Widget und Erweiterung teilen die App Group
  **`group.de.theoldphilip.Reisebuch`** (nie die des Gym-Projekts); darin legt die App unter dem Schlüssel **`widget_stand`** die Termine
  als JSON ab. `Reisebuch/WidgetStand.swift` gehört zu beiden Targets (Ausnahme im synchronisierten Ordner). Versionen von App, Widget und
  Erweiterung müssen gleich sein (10 Vorkommen je Schlüssel). URL-Schema `reisebuch` steht in `Reisebuch/Info.plist`.
- **Der Vertrag mit dem Server ist `<repo>/docs/API.md`.** Die Typen der Web-App (`<repo>/web/src/types.ts`) spiegeln die Antworten des
  Servers und sind die beste Vorlage für die Swift-Modelle (`Codable`). Feldnamen sind camelCase und werden **nicht** umbenannt. Unbekannte
  Felder ignorieren, neue Felder sind optional: Der Server bekommt laufend Felder dazu, die App darf daran nicht zerbrechen.
- Zeiten von Einträgen sind **lokale Zeit + IANA-Zeitzone** (`startLocal` `2027-05-08T09:40` oder nur `2027-05-08`, `startTz`). Nicht in UTC
  umrechnen, um sie anzuzeigen: Angezeigt wird die Ortszeit, wie sie dasteht. Hafenzeiten sind `HH:MM` in der `timezone` des Tages.
- Anmeldung: `POST /api/auth/login` mit `{username, password, deviceName}` → `{user, token}`. Danach jede Anfrage mit
  `Authorization: Bearer <token>`. Tokens laufen nicht ab; `POST /api/auth/logout` macht sie ungültig.
- Server-Adressen: `http://172.16.10.1:8080` (Heimnetz/VPN, unverschlüsselt) und `https://172.16.10.1:8444` (selbst erzeugtes Zertifikat
  „Bordbuch“, auf Philips iPhone als vertrauenswürdig installiert; der Simulator vertraut ihm nicht).

## Regeln (verbindlich)
1. **Git statt Backup-Ordner.** Es gibt keinen `Backup/`-Ordner. Jeder Stand ist ein Commit; zurück geht es über die Git-Historie. Committe
   in sinnvollen Schritten, nie Halbfertiges mit rotem Build (Ausnahme `STAND.md`, Regel 6).
2. **Version bei jeder Änderung hochzählen:** `MARKETING_VERSION` und `CURRENT_PROJECT_VERSION` in `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj`,
   **alle** Vorkommen (vorher mit `grep -c` zählen; Debug und Release je Target müssen gleich sein). Die Version steht im Auftrag. Sie ist
   **unabhängig** von der Server-Version in `<repo>/VERSION`; die fasst du nicht an.
3. **Komplette Dateien, nur Gelesenes ändern.** Jede lange Swift-Datei endet mit `// ENDE <Dateiname>`. Schreibe nie eine Datei aus dem
   Gedächtnis neu, ohne sie vorher gelesen zu haben. Ändere nur, was der Auftrag verlangt; keine Umbauten nebenbei.
4. **Kein Geheimnis im Repo oder in der Ausgabe.** Kein Token, kein Passwort, keine Apple-ID-Daten, keine E-Mail-Adresse. Zugangsdaten tippt
   Philip selbst in App oder Simulator ein; das Token liegt nur im Schlüsselbund. Prüfe vor jedem Commit mit `git diff --cached`.
5. **Signing, Team, Capabilities, Entitlements, Profile nicht ohne Rückfrage ändern.** Das Projekt und neue Targets legt Philip in Xcode an.
6. **Kein force-push, kein Umschreiben der Historie.** Vor dem Push `git pull --rebase origin main` (der Architekt pusht zwischendurch). Code
   erst pushen, wenn der Build grün ist. `ios/STAND.md` darfst du jederzeit einzeln committen und pushen, auch bei rotem Build.
7. **Commit-Identität:** `git -c user.name="Claude (Mac)" -c user.email=noreply@anthropic.com commit …`, damit keine private Adresse in die
   Historie kommt. Commit-Meldungen auf Deutsch, mit Version in der Betreffzeile, z. B. `iOS 0.1.0: Anmeldung und Reiseliste`.
   **Zusätzlich fest im Klon eingestellt** (nur dieses Repo, nicht global): `git config --local user.name "Claude (Mac)"` und
   `git config --local user.email noreply@anthropic.com`. **Vor jedem Commit prüfen:** `git config user.email` muss `noreply@anthropic.com`
   ausgeben; sonst die beiden Befehle ausführen und erst dann committen. Nach jedem Commit `git log -1 --format='%ae %ce'`: beide
   `noreply@anthropic.com`, sonst **nicht pushen**, sondern melden (ein noch nicht gepushter Commit darf mit
   `git commit --amend --no-edit --reset-author` berichtigt werden, ein gepushter nie). Anlass: Der IPA-Commit `2456291` von 0.2.0 trug eine
   private Adresse und ist nicht mehr zu entfernen.
8. **Nur Beauftragtes tun.** Bei Entscheidungen, die sich nicht zurücknehmen lassen und beide Wege zulassen: aufhören und fragen (in
   `STAND.md` unter „Offene Fragen an den Architekten“ und im Terminal an Philip).
9. **Nichts installieren ohne Rückfrage** (kein Homebrew, keine Pakete, keine Swift-Packages von außen), außer der Auftrag nennt es.
10. **Lies nichts außerhalb von `<repo>`** (kein Gym-Projekt, kein Papierkorb, keine anderen Projekte, kein Schlüsselbund, keine Browser-Daten).

## Bauen und Testen
- Im Ordner `ios/Reisebuch`. Erst ansehen: `xcodebuild -list -project Reisebuch.xcodeproj` und `xcrun simctl list devices available`. Keine Gerätenamen raten.
- Build: `xcodebuild -project Reisebuch.xcodeproj -scheme Reisebuch -destination 'platform=iOS Simulator,name=<iPhone aus der Liste>' build`.
- Fehler: erst die erste echte Fehlermeldung beheben, nicht alle Folgefehler. Jede Warnung in `STAND.md` melden.
- Testdaten: Gegen den echten Server nur mit einem Konto, dessen Zugangsdaten Philip **selbst** im Simulator eintippt; du liest sie nie aus,
  schreibst sie nirgends hin. Alternativ der Testserver des Repos (echte App mit Fake-KI und leerer Datenbank): `scripts/dev/fake-server.ts`
  auf Port 8091 (siehe `<repo>/CLAUDE.md` Abschnitt 7). Er braucht Node ≥ 22.18; ist Node nicht da, **nicht installieren**, sondern melden.
- Bildschirmfotos aus dem Simulator (`xcrun simctl io booted screenshot`) in einen Ordner außerhalb des Repos oder `ios/shots/` (nicht in Git).
- Auf Philips iPhone installierst du **nur nach seinem ausdrücklichen Auftrag**. IPA nur nach ausdrücklicher Freigabe.
- IPA (nach Freigabe): in `ios/Reisebuch` `xcodebuild … -configuration Release -destination 'generic/platform=iOS' -archivePath <Scratchpad>/Reisebuch-<V>-b<B>.xcarchive -allowProvisioningUpdates archive`,
  dann `xcodebuild -exportArchive -archivePath … -exportOptionsPlist ExportOptions.plist -exportPath <Scratchpad>/export -allowProvisioningUpdates`.
  Ablage `ios/Installation/<V>-b<B>/Reisebuch-<V>-b<B>.ipa` + `SHA256.txt` (`shasum -a 256`), nur die letzten drei Versionen behalten.

## Womit du anfängst
1. Trennungsprüfung (oben).
2. `git pull --rebase origin main`.
3. `ios/STAND.md` lesen (falls vorhanden) und den offenen Auftrag `ios/AUFTRAG-<Version>.md`.
4. Ohne Auftrag nichts ändern.

## Vorlage für STAND.md
```
# STAND (iOS), <Datum, Uhrzeit>
## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
## Was ich getan habe
## Build-Ergebnis: grün oder rot, erste Fehlermeldung wörtlich, Warnungen
## Geänderte Dateien
## Commits (Hashes)
## Offene Fragen an den Architekten
## Was Philip auf dem iPhone testen soll
```

## Stand der App
**Neu in 0.1.0** (Build 1, Auftrag in `ios/Auftraege/AUFTRAG-0.1.0.md`): Projekt `ios/Reisebuch/` (nur iPhone, iOS 26.2), Anmeldung mit
Token im Schlüsselbund und Abmelden bei 401, Einstellungen (angemeldet als, Server, Versionen, Abmelden), Reiseliste (laufend/kommend,
„Vergangen“), Ablauf lesend (Abschnitte, Tage, Einträge, Ortszeile Terminal/Schalter/Gate/Kofferband/Gleis, Kreuzfahrt-Tag mit „Alle an
Bord“, Hinweis-Kasten mit „Quittiert“), Detail von Eintrag und Hafentag mit Zusatzinfos (`tel:`, `mailto:`, Link, „bitte prüfen“).
Kein ATS-Eintrag nötig (IP-Adressen sind ausgenommen, per Test belegt). Dateien: `Models`, `APIClient`, `AppSession`, `Keychain`,
`Format`, `LoginView`, `TripListView`, `TripTimelineView`, `DetailViews`. Unit-Tests in `ReisebuchTests`.
Hinweis zum Testen: Der Mac erreicht den Server nicht; Daten im Simulator nur mit eigenem Beispielserver (nicht im Repo). Der
Simulator hat keine Emoji-Schrift (auch Safari zeigt „?“), Symbole also nur auf dem iPhone prüfbar.

**Neu in 0.2.0** (Build 2, Auftrag in `ios/Auftraege/AUFTRAG-0.2.0.md`): Offline lesen (`ResponseCache`: rohe Antworten von Liste und
Abläufen in Application Support/`cache/`, Band „Offline · Stand …“, Vorladen laufender/kommender Reisen, Abmelden löscht alles),
Jetzt-Markierung und Ausgrauen (`NowLogic`, Regeln wie `Trip.tsx`), Reisetag-Abfrage im Detail von Flug/Zug/Mietwagen
(`PlaceLookupView`, nur bei `ai/status.placeLookup` und Rolle owner/editor; „Übernehmen“ = `PATCH` mit allen bisherigen `details`, einziger
schreibender Aufruf). `details` wird verlustfrei als `JSONValue` gelesen. Tests in `ReisebuchTests/NowLogicTests.swift`.
Release-Build zeigt manche Concurrency-Warnungen, die Debug nicht zeigt: vor dem IPA-Export auf Warnungen im Archiv-Log achten.

**Neu in 0.3.0** (Build 3, Auftrag in `ios/Auftraege/AUFTRAG-0.3.0.md`): Widget „Nächster Termin“ (`ReisebuchWidget/`, Sperrbildschirm
rechteckig und eine Zeile, Home klein und mittel). Die App stellt in `WidgetFeed.swift` aus den gespeicherten Abläufen laufender und
kommender Reisen die Termine zusammen (Ende in der Zukunft, Beginn höchstens 7 Tage voraus, höchstens 30; Hafentag als „Alle an Bord“)
und legt sie per `WidgetStandStore` ab, nach jedem Laden von Liste/Ablauf und beim Start; Widget-Neuladen nur bei geänderten Terminen.
Abmelden löscht den Stand. Widget-Timeline mit Einträgen zu Beginn, 24 h vor Beginn und kurz nach Ende jedes Termins. Antippen öffnet
`reisebuch://trip/<id>` (Liste, dann Ablauf). `NowLogic.entryStart` neu. Tests in `ReisebuchTests/WidgetTests.swift`.
Hinweis Simulator: Hinzufügen eines Widgets per UI-Test lässt SpringBoard abstürzen; Prüfung über die Widget-Galerie. Bei gleicher
Versionsnummer hält das System die alte Widget-Erweiterung fest; nach Änderungen am Widget App im Simulator neu installieren.

**Neu in 0.4.0** (Build 4, Auftrag in `ios/Auftraege/AUFTRAG-0.4.0.md`): Benachrichtigungen über APNs (`Push.swift`). Capability Push
Notifications nur beim App-Target (Entitlements `aps-environment` + App Group). Einstellungen → „Benachrichtigungen“ (nur bei
`GET /api/push/apns` → `enabled`): Schalter meldet das Token (Hex, klein, `deviceName` „iPhone-App“) an und setzt `notifications.enabled`,
Testnachricht, Abmelden meldet das Token vorher ab. Session und `PushController` gehören dem `AppDelegate` (`@UIApplicationDelegateAdaptor`).
Antippen: `url` `/trips/<id>` → `reisebuch://trip/<id>` wie beim Widget. Mitteilungs-Delegate mit Completion-Handler (die `async`-Variante
stürzte beim Antippen ab). Ad-hoc-Profil der App muss `aps-environment` = `production` enthalten. Tests in `ReisebuchTests/PushTests.swift`.
Hinweis Simulator: `xcrun simctl push booted de.theoldphilip.Reisebuch <datei.apns>`; UI-Tests laufen sonst auf geklonten Simulatoren
ohne Anmeldung, daher `-parallel-testing-enabled NO`.

**Neu in 0.5.0** (Build 5, Auftrag in `ios/Auftraege/AUFTRAG-0.5.0.md`): Erinnerungen am Ort (`PlaceReminders.swift`): lokale
Mitteilungen mit `UNLocationNotificationTrigger` (Erlaubnis „Beim Verwenden“), Kennungen `ort-*`, höchstens 20, Auswahl der nächsten 36 h
als reine Funktion `OrtAuswahl` (Tests `PlaceReminderTests.swift`), Ortssuche `OrtSuche` mit MapKit (`MKLocalSearch`, `MKGeocodingRequest`,
`MKMapItem.location`; Cache `cache/places.json`). Capability Background Modes nur „Background fetch“, `BGAppRefreshTask`
`de.theoldphilip.Reisebuch.refresh` (Info.plist). Reise-Detail `GET /trips/:id` wird beim Vorladen gespeichert (`cache/trip-<id>.json`,
`TripDetail`). `AppSession.onCacheChanged` löst das Planen aus. IPAs werden nur noch am Ende einer Auftragsreihe committet (Push der IPA
wird von der Sicherheitsprüfung blockiert, Philip pusht sie).

**Neu in 0.6.0** (Build 6, Auftrag in `ios/Auftraege/AUFTRAG-0.6.0.md`): Bearbeiten. `EditLogic.swift` (rein, Tests `EditLogicTests.swift`):
Felder je Art wie `ItemForm.tsx` (`ItemKinds`), `EditMerge.details` (details verlustfrei), `EditMerge.changed` (PATCH nur mit geänderten
Feldern), `LocalTime` (Ortszeit-Text, DatePicker über UTC-Kalender), `MoneyInput` (wie `MoneyFields.tsx`), `ViewMode` (wie `Trip.tsx`).
`EditForms.swift`: Formulare Eintrag/Reise/Kreuzfahrt/Reisetag, Zeitzonen-Auswahl mit Suche, Zusatzinfos. Rolle und Kreuzfahrten aus
`TripDetail` (`GET /trips/:id`). Entsperren nur im Speicher (`AppSession.unlockedTrips`). Quittieren im Hinweis-Kasten.

**Neu in 0.7.0** (Build 7, Auftrag in `ios/Auftraege/AUFTRAG-0.7.0.md`): Dokumente und Teilen. Target `ReisebuchShare` (von Philip,
App Group). Gemeinsam mit der Erweiterung (Ausnahme im synchronisierten Ordner, darum `nonisolated`): `APIClient.swift`, `Models.swift`,
`Keychain.swift` (Token in der Schlüsselbund-Gruppe `group.de.theoldphilip.Reisebuch`, einmaliger Umzug `Keychain.migrate`, `SharedStore`
für Server-Adresse/Name), `DocumentLogic.swift` (Analyse-Modelle, apply-Body, Status-Texte, Mehrteil-Upload als Datei; Tests
`DocumentTests.swift`). App: `DocumentsView.swift` (Liste, Quick Look, Dateien/Fotos/Scanner, Vorschläge prüfen). Mitteilung mit
`documentId` → `AppSession.pendingDocumentId`. Im Test-Target heißt `Attachment` auch ein Typ von Swift Testing: `Reisebuch.Attachment`.


**Neu in 0.8.0** (Build 8, Auftrag in `ios/Auftraege/AUFTRAG-0.8.0.md`): KI-Funktionen wie Web. `AILogic.swift` (rein + `extension
APIClient` für die KI-Aufrufe, nur App; Tests `AILogicTests.swift`): `AIFeatures` (Knöpfe nach `/ai/status` und Rolle), Reise prüfen
(`TripReviewView.swift`), Recherche (in `DocumentsView.swift`), `ProposalEdit` (Vorschlag im Formular bearbeiten, nur im Speicher),
`TripTitle` (Name aus `suggestedTripTitle`), `AIConfigBody`. `InputCollector.swift`: Dateien/Fotos/Scan/Text sammeln, zusammen auswerten
(`/attachments` + `/documents/group?background=1`). `AISettingsView.swift`: KI-Anbieter (Admin); API-Schlüssel nie speichern.
`AppSession.aiStatus` und `isAdmin` (aus `/me`). Vorbelegung der Vorschläge wie `DocReview.tsx`.
