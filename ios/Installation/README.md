# Installation: signierte IPAs der iPhone-App Reisebuch

Hier liegen fertig signierte Installationsdateien (IPA) der App, je Version ein Ordner `<Version>-b<Build>/` mit der IPA und
`SHA256.txt` (Prüfsumme).

- Signierung: Ad-hoc (`release-testing`) mit Philips Team. Installierbar nur auf Geräten, die im Apple-Developer-Account registriert
  sind; das Profil steckt in der IPA und läuft nach einem Jahr ab (Datum steht in `ios/STAND.md`).
- Installieren (Philip, am Mac):
  - **Finder:** iPhone per Kabel anschließen, entsperren, im Finder in der Seitenleiste das iPhone wählen, die IPA in das Fenster ziehen.
  - **Apple Configurator:** iPhone anschließen, „Hinzufügen → Apps…“ bzw. die IPA auf das Gerät ziehen.
  - Prüfsumme vorher: `shasum -a 256 Reisebuch-<Version>.ipa` muss mit `SHA256.txt` übereinstimmen.
- Es bleiben nur die **letzten drei Versionen** in diesem Ordner. Ältere werden gelöscht und sind über die Git-Historie erreichbar.
- Gebaut wird nach `ios/CLAUDE.md` („Bauen und Testen“), Exporteinstellungen in `ios/Reisebuch/ExportOptions.plist`.
