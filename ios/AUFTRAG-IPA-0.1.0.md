# AUFTRAG-IPA-0.1.0.md: Signierte IPA von 0.1.0 (Build 1) ins Repo

**Philip gibt hiermit die IPA frei.** Er installiert sie selbst über seinen Rechner. Du installierst **nichts** auf ein Gerät.
Keine Code-Änderung, keine neue Version: Es bleibt **0.1.0, Build 1**.

## Vorher
Trennungsprüfung aus `ios/CLAUDE.md`, `git pull --rebase origin main`. Nichts aus dem Gym-Projekt verwenden, auch **nicht** dessen
`ExportOptions.plist` als Vorlage öffnen. Du legst eine eigene an.

## Bauen
1. Neue Datei `ios/Reisebuch/ExportOptions.plist` (kommt ins Repo):
   - `method` = `release-testing` (Ad-hoc-Verteilung an registrierte Geräte; heißt in älteren Xcode-Versionen `ad-hoc`. Nimm, was
     `xcodebuild -help` bzw. die Fehlermeldung von Xcode 26.3 verlangt.)
   - `signingStyle` = `automatic`, `teamID` = das Team aus `project.pbxproj` (`DEVELOPMENT_TEAM`; die Team-ID ist kein Geheimnis).
   - `compileBitcode` = false, `stripSwiftSymbols` = true, `thinning` = `<none>`.
2. Im Ordner `ios/Reisebuch`:
   ```
   xcodebuild -project Reisebuch.xcodeproj -scheme Reisebuch -configuration Release \
     -destination 'generic/platform=iOS' -archivePath <Scratchpad>/Reisebuch-0.1.0-b1.xcarchive \
     -allowProvisioningUpdates archive
   xcodebuild -exportArchive -archivePath <Scratchpad>/Reisebuch-0.1.0-b1.xcarchive \
     -exportOptionsPlist ExportOptions.plist -exportPath <Scratchpad>/export -allowProvisioningUpdates
   ```
   Das Archiv bleibt im Scratchpad (`*.xcarchive` ist ohnehin in `.gitignore`).
3. **Signing nicht dauerhaft ändern.** `project.pbxproj` muss danach unverändert sein (`git diff --stat` leer für diese Datei). Scheitert der
   Export am Signing, nicht im Projekt herumstellen, sondern die erste Fehlermeldung wörtlich in `STAND.md` und Philip fragen. Erlaubt sind
   nur Überschreibungen auf der Kommandozeile (wie `CODE_SIGN_STYLE=Automatic`), wenn sie nötig sind.
4. Das Gerät muss im Developer-Account registriert sein, sonst lässt sich eine Ad-hoc-IPA nicht installieren. Philips iPhone ist es vom
   Gym-Projekt her; prüfen kannst du es nicht. Steht im Export-Protokoll eine Geräteliste, die Anzahl der Geräte (nicht die UDIDs) in
   `STAND.md` nennen.

## Ablage
- `ios/Installation/0.1.0-b1/Reisebuch-0.1.0-b1.ipa`
- `ios/Installation/0.1.0-b1/SHA256.txt` mit der Ausgabe von `shasum -a 256 Reisebuch-0.1.0-b1.ipa`
- `ios/Installation/README.md` (neu): wofür der Ordner ist, wie Philip installiert (zum Beispiel Apple Configurator oder Finder bei
  angeschlossenem iPhone: IPA auf das Gerät ziehen), dass nur die letzten drei Versionen hier liegen und ältere in der Git-Historie.
- Vor dem Commit: `git diff --cached --stat` zeigt nur Pfade unter `ios/`. Die IPA ist eine Binärdatei; prüfe, dass keine
  `.mobileprovision` oder Zertifikatsdatei einzeln mit ins Repo kommt (in der IPA steckt das Profil, das ist so richtig).

## Rückgabe
`ios/STAND.md`: Befehle, Ergebnis, Größe der IPA, SHA256, welche Profile neu entstanden sind (Name, nicht Inhalt), dass `project.pbxproj`
unverändert blieb. Dann diesen Auftrag nach `ios/Auftraege/` verschieben, committen (`iOS 0.1.0 (1): IPA signiert`), pull, push.
In `ios/CLAUDE.md` unter „Bauen und Testen“ zwei Zeilen zum IPA-Weg ergänzen (Befehl, Ablage), damit es beim nächsten Mal gleich geht.
