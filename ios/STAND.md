# STAND (iOS), 27.11.2026

Auftrag: `ios/AUFTRAG-0.1.0.md` inkl. Nachtrag 1. Teil 0.3 erledigt, weiter mit Teil A.

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
- Targets: Reisebuch, ReisebuchTests, ReisebuchUITests; Schema: Reisebuch. Version noch 1.0 / Build 1 (6 Vorkommen je Schlüssel).
- **Abweichung:** `ios/Reisebuch/.git` existiert (eigenes Repository von Xcode, ein Commit `cdb32a1 Initial Commit`, kein Remote).
  Der Schalter „Create Git repository on my Mac“ war offenbar doch an. Gemeldet (Commit d592c2d). Philip hat das Löschen freigegeben,
  nach Prüfung (`git -C Reisebuch log --oneline --all` = nur `cdb32a1`, `remote -v` leer, nur Branch main) gelöscht.
- `ios/.gitignore` angelegt (xcuserdata/, *.xcuserstate, DerivedData/, *.xcarchive, shots/, .DS_Store).

## Was ich getan habe
- Trennungsprüfung und Prüfung 0.3 ausgeführt, inneres .git nach Freigabe gelöscht, .gitignore angelegt, leeres Projekt gebaut und committet.
- Node fehlt auf dem Mac (nicht installiert); Test später nach Nachtrag 1 Punkt 2 gegen den echten Server.

## Build-Ergebnis
Leeres Projekt: grün (iPhone 17 Pro Simulator). Einzige Meldung, keine Code-Warnung:
`appintentsmetadataprocessor warning: Metadata extraction skipped. No AppIntents.framework dependency found.`

## Geänderte Dateien
- `ios/STAND.md` (neu), `ios/.gitignore` (neu), `ios/Reisebuch/` (leeres Xcode-Projekt)

## Commits (Hashes)
- d592c2d (STAND, Meldung .git)
- Projekt-Commit „iOS 0.1.0: leeres Projekt Reisebuch angelegt“

## Offene Fragen an den Architekten
- Frage zu `ios/Reisebuch/.git` erledigt (von Philip freigegeben und gelöscht).
- Push vom Mac: Es fehlen GitHub-Zugangsdaten (`could not read Username`). Philip richtet das ein; bis dahin liegen Commits nur lokal.

## Was Philip auf dem iPhone testen soll
Noch nichts.
