# STAND (iOS), 27.11.2026

Auftrag: `ios/AUFTRAG-0.1.0.md` inkl. Nachtrag 1, erledigt und nach `ios/Auftraege/` verschoben. Test mit echten Daten steht aus
(nur auf dem iPhone möglich, siehe Teil E).

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
git log --oneline -3           -> 191e7a5 iOS AUFTRAG-0.1.0: Nachtrag 1 …, 8b561ba iOS: Briefing …, b992cfd Dokument-Analyse … (0.10.1)
```
Ergebnis: bestanden. Pfad enthält kein „gym“.

## Prüfung nach dem Anlegen des Projekts (Teil 0.3)
- `ios/Reisebuch/Reisebuch.xcodeproj` existiert, kein zweites `.xcodeproj` unter `ios/`.
- Bundle-IDs: nur `de.theoldphilip.Reisebuch`, `de.theoldphilip.ReisebuchTests`, `de.theoldphilip.ReisebuchUITests`.
- `grep -ric gymnative ios/`: Treffer nur in `CLAUDE.md` (5) und `AUFTRAG-0.1.0.md` (1), wie erwartet.
- Keine `.entitlements`-Datei.
- Targets: Reisebuch, ReisebuchTests, ReisebuchUITests; Schema: Reisebuch.
- **Abweichung:** Xcode hatte trotz ausgeschaltetem Schalter `ios/Reisebuch/.git` angelegt (ein Commit `cdb32a1 Initial Commit`,
  kein Remote). Gemeldet (Commit d592c2d). Philip hat das Löschen freigegeben; nach Prüfung (`git -C Reisebuch log --oneline --all` =
  nur `cdb32a1`, `remote -v` leer, nur Branch main) gelöscht.
- `ios/.gitignore` angelegt (xcuserdata/, *.xcuserstate, DerivedData/, *.xcarchive, shots/, .DS_Store).

## Was ich getan habe
- **Teil A:** Version 0.1.0 / Build 1 in allen 6 Vorkommen (3 Targets × Debug/Release). App-Symbol aus `ios/Design/AppIcon-1024.png`
  im Asset-Katalog (eine Größe). Anzeigename `INFOPLIST_KEY_CFBundleDisplayName = Reisebuch`. `TARGETED_DEVICE_FAMILY` von „1,2“
  (iPhone + iPad, Xcode-Vorgabe) auf `1` (nur iPhone) gestellt, weil der Auftrag „nur iPhone“ sagt. Hoch- und Querformat wie von Xcode
  vorgegeben. Keine fremden Pakete (Foundation, SwiftUI, Security, Observation).
- **ATS:** keine Ausnahme nötig, `Info.plist` unverändert. Belegt per Unit-Test `plainHTTPToHomeServerIsAllowed`: Anfrage an
  `http://172.16.10.1:8080/api/version` endet nicht mit ATS-Fehler -1022 (sondern Zeitüberschreitung, Server vom Mac aus gerade nicht
  erreichbar). Gegenprobe: mit `http://example.com` wird der Test sofort rot (ATS blockiert Domainnamen, IP-Adressen nicht).
- **Teil B:** Anmeldung (Adresse mit Vorgabe, Benutzername, Passwort), Token im Schlüsselbund (Service `de.theoldphilip.Reisebuch`,
  Account `token`, `AfterFirstUnlockThisDeviceOnly`), Adresse und Anzeigename in UserDefaults, kein Passwort gespeichert. Fehlertexte:
  nicht erreichbar → „Server nicht erreichbar. Ist das VPN an?“, 401 → „Benutzername oder Passwort falsch.“, sonst `error` der Antwort.
  401 bei jeder späteren Anfrage → lokal abmelden, Hinweis auf der Anmeldeseite. Einstellungen (Zahnrad in der Reiseliste):
  angemeldet als, Server, App-Version/Build, Server-Version mit Datenbank-Stand, Abmelden (lokal auch offline).
- **Teil C:** Reiseliste mit Symbol je Reiseart, Zeitraum deutsch („8. Mai – 13. Mai 2027“), Schiffe bei Kreuzfahrten, „Vergangen“
  (Ende vor heute), Ziehen zum Aktualisieren, Hinweis bei leerer Liste.
- **Teil D:** Ablauf mit Abschnitten → Tagen („Sa., 8. Mai“) → Einträgen. Eintrag: Uhrzeit, Symbol, Titel (bei `role: end`
  „Check-out · …“ usw.), Ortszeile fett (Terminal · Schalter · Gate · Kofferband / Gleis / Schalter), Kurzzeile wie `itemSubtitle`.
  Kreuzfahrt-Tag: Art, Hafen, Ankunft/Abfahrt, „Alle an Bord“ als orangefarbenes Feld, „Tenderhafen“. Hinweis-Kasten oben, aufklappbar,
  Anzahl nur offene, Farbe nach schlimmstem Level, bei Fehlern (`error`) aufgeklappt; „Quittiert (n)“ als eigene Aufklappgruppe;
  „nur persönlich“ als Etikett; offene Hinweise mit `itemId` klein am Eintrag (bei gesetzter `role` nur am passenden Auftritt).
  Detail Eintrag: Zeiten mit Zone („MESZ, Europe/Zurich“), Ort, Anbieter, Buchungsnummer, Preis/Zahlung, Details mit deutschen
  Namen (Schlüssel aus `web/src/components/ItemForm.tsx`), Zusatzinfos (`tel:` ohne Leerzeichen, `mailto:`, Link, Text,
  „bitte prüfen“ bei ai/web), Notizen. Detail Hafentag mit `cruiseDay.infos`.
- Modelle tolerant: Aufzählungen als String, fast alles optional, `details` liest auch Zahlen/Wahrheitswerte, unbekannte Felder ignoriert.
- Unit-Tests (Swift Testing): Dekodieren einer Timeline nach `docs/API.md` (inkl. unbekanntem Feld und Level), Reiseliste,
  Formatierung (Zeitraum, Jahreswechsel, Tagesüberschrift, `tel:`, Adresse), ATS. 4/4 grün.
- Node fehlt auf dem Mac (nicht installiert), daher Teil E nach Nachtrag 1 Punkt 2 gegen den echten Server.

## Build-Ergebnis
Grün (iPhone 17 Pro Simulator, Xcode 26.3, Deployment Target iOS 26.2). Keine Compiler-Warnungen. Einzige Meldung im Log:
`appintentsmetadataprocessor warning: Metadata extraction skipped. No AppIntents.framework dependency found.` (Build-Werkzeug, kein Code).

## Teil E: Prüfen mit Daten
- **Echter Server: auf diesem Mac nicht möglich.** Laut Philip erreicht der Mac den Server nie (auch der Simulator nicht, er nutzt
  das Netz des Macs). Node fehlt, der Testserver des Repos fällt also auch aus. Test mit echten Daten geht nur auf Philips iPhone
  und braucht dessen eigene Freigabe zur Installation.
- **Ersatz:** kleiner Python-Beispielserver nur im Scratchpad (nicht im Repo, nichts installiert) mit erfundenen Daten nach
  `docs/API.md` (Kreuzfahrt mit Anreise-Flug mit Gate, Hotel mit Check-out, Einschiffung, Seetag, Tender-Hafentag mit Ausflug,
  Ausschiffung, Zug mit Gleis, drei Hinweise davon einer quittiert und einer „nur persönlich“). Gesteuert über einen Wegwerf-UI-Test
  (danach gelöscht, nicht committet). Danach Server beendet.

## Bildschirmfotos (nicht im Repo, nur Scratchpad, erfundene Daten)
- Anmeldung: Kompass-Symbol, „Reisebuch“, Server-Vorgabe, Knopf ausgegraut bis alles ausgefüllt. Falsches Passwort → rot
  „Benutzername oder Passwort falsch.“
- Reiseliste: zwei kommende Reisen oben (Zeitraum „8. Mai – 13. Mai 2027“, Schiff darunter), eine unter „Vergangen“.
- Ablauf: Hinweis-Kasten rot (es gibt einen `error`), aufgeklappt, „2 Hinweise“, Etikett „nur persönlich“, „Quittiert (1)“
  zugeklappt. Abschnitte „Anreise“, „Kreuzfahrt · MS Beispiel“, „Abreise“, Tage „Sa., 8. Mai“. Flug mit fetter Zeile
  „Terminal 1 · Schalter 31–40 · Gate B12“, „Check-out · Hotel …“ am Folgetag mit rotem Hinweis. Kreuzfahrt-Tage mit orangem
  „Alle an Bord 17:00“, „Tenderhafen“, Seetag, Ausschiffung.
- Flug-Detail: Abflug/Ankunft mit „MESZ, Europe/Zurich“ bzw. „Europe/Madrid“, Anbieter, Buchungsnummer, Preis „420,50 €“, bezahlt,
  Details mit deutschen Namen.
- Hafentag-Detail: Ankunft, Abfahrt, „Alle an Bord“ orange, Tenderhafen, Zeitzone, Zusatzinfo mit „bitte prüfen“ und Anruf-Link.
- Ausflug-Detail: Hinweis, Zeiten, Treffpunkt, „Gebucht über: privat“, Telefonnummer als Anruf-Link, Notruf mit „bitte prüfen“.
- Einstellungen: „Testkonto“, Server, App „0.1.0 (Build 1)“, Server „0.10.1 · Datenbank-Stand 9“, Abmelden → zurück zur Anmeldung.
- **Auffällig: Alle Emojis erscheinen im Simulator als „?“-Kästchen.** Ursache ist der Simulator, nicht die App: Die Quelle enthält die
  richtigen Zeichen (`✈️` = E2 9C 88 EF B8 8F), und eine einfache HTML-Seite mit Emojis zeigt in Safari im selben Simulator ebenfalls
  „?“. Auf dem iPhone sollten sie erscheinen; nicht geprüft.

## Geänderte Dateien
- `ios/STAND.md`, `ios/.gitignore`
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (Version, nur iPhone, Anzeigename)
- `ios/Reisebuch/Reisebuch/`: `ReisebuchApp.swift`, `ContentView.swift`, `Models.swift`, `APIClient.swift`, `AppSession.swift`,
  `Keychain.swift`, `Format.swift`, `LoginView.swift`, `TripListView.swift`, `TripTimelineView.swift`, `DetailViews.swift`,
  `Assets.xcassets/AppIcon.appiconset/` (Symbol)
- `ios/Reisebuch/ReisebuchTests/ReisebuchTests.swift`

## Commits (Hashes)
- d592c2d STAND, Meldung .git
- 689870c iOS 0.1.0: leeres Projekt Reisebuch angelegt
- 8459ed4 iOS 0.1.0: Anmeldung, Reiseliste und Ablauf lesen
- folgender Commit: iOS 0.1.0: Auftrag abgeschlossen, STAND und Briefing

## Offene Fragen an den Architekten
- Push vom Mac: Es fehlen GitHub-Zugangsdaten (`could not read Username`). Philip richtet das ein; bis dahin liegen Commits nur lokal.
- `TARGETED_DEVICE_FAMILY` auf nur iPhone gestellt (rückgängig machbar). Falls iPad doch gewünscht ist, bitte melden.

## Was Philip auf dem iPhone testen soll (sobald die Installation freigegeben ist)
1. Anmelden mit `http://172.16.10.1:8080` (VPN an); einmal mit falschem Passwort, einmal ohne VPN (Meldung „Ist das VPN an?“).
2. Reiseliste: Reisen, Zeiträume, Schiffe, „Vergangen“; Symbole (Emojis) sichtbar?
3. Eine Kreuzfahrt öffnen: Hinweis-Kasten mit gleicher Anzahl offener Hinweise wie in der Web-App, „Quittiert“, Gate/Schalter fett,
   „Alle an Bord“, Tenderhafen.
4. Einen Eintrag mit Telefonnummer antippen, Nummer antippen → Anrufdialog.
5. Einstellungen: Server-Version wie in der Web-App unter „Über Reisebuch“; Abmelden.
6. Querformat und Hellmodus kurz ansehen.
