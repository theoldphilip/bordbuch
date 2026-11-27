# STAND (iOS), 27.11.2026

Auftrag: `ios/AUFTRAG-0.1.0.md` inkl. Nachtrag 1. **Angehalten in Teil 0.3**: Xcode hat ein eigenes `.git` in `ios/Reisebuch/` angelegt.

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
  Der Schalter „Create Git repository on my Mac“ war offenbar doch an. Laut Nachtrag 1: angehalten, nichts gelöscht.
  Folge: Das äußere Repo sieht `ios/Reisebuch/` als eingebettetes Repository; ein `git add` würde nur einen Verweis (gitlink) statt der
  Dateien committen. Deshalb noch kein Projekt-Commit.

## Was ich getan habe
- Trennungsprüfung und Prüfung 0.3 ausgeführt, nur gelesen. Am Projekt nichts geändert, nichts gebaut.
- Node fehlt auf dem Mac (nicht installiert); Test später nach Nachtrag 1 Punkt 2 gegen den echten Server.

## Build-Ergebnis
Noch nicht gebaut.

## Geänderte Dateien
- `ios/STAND.md` (neu)

## Commits (Hashes)
- dieser Commit (nur STAND.md)

## Offene Fragen an den Architekten
1. Darf `ios/Reisebuch/.git` gelöscht werden (`rm -rf ios/Reisebuch/.git`)? Es enthält nur Xcodes leeren Anfangs-Commit, nichts Eigenes.
   Alternativ löscht Philip den Ordner selbst. Danach mache ich mit 0.3 weiter (`.gitignore`, Build, erster Commit).

## Was Philip auf dem iPhone testen soll
Noch nichts.
