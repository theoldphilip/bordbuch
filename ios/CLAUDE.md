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
