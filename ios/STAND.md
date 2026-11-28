# STAND (iOS), 28.11.2026, 00:55

Auftrag: `ios/AUFTRAG-0.4.0.md` (0.4.0, Build 4), erledigt und nach `ios/Auftraege/` verschoben. Rückgabe zu 0.3.0 steht in der
Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. `git config user.email` → `noreply@anthropic.com`.

## Teil 0: Capability (von Philip angelegt), Prüfung
- Philip hat beim Target **Reisebuch** „Push Notifications“ hinzugefügt, sonst nichts.
- `Reisebuch/Reisebuch.entitlements`: `aps-environment` (`development`, beim Ad-hoc-Export setzt Xcode `production`) und weiter nur die
  App Group `group.de.theoldphilip.Reisebuch`. `ReisebuchWidgetExtension.entitlements` unverändert (nur die App Group).
- `project.pbxproj` änderte sich durch die Capability nicht (nur die Entitlements-Datei). `grep -ri GymNative ios/Reisebuch` leer.

## Was ich getan habe
- **Teil A, Anmelden des Geräts** (`Push.swift` neu, `APIClient.swift`, `SettingsView.swift`):
  - Einstellungen → Bereich „Benachrichtigungen“. Fragt `GET /api/push/apns`. Bei `enabled: false`: „Auf dem Server noch nicht
    eingerichtet.“
  - Schalter „Auf diesem iPhone“: Erlaubnis (`.alert`, `.sound`), dann `registerForRemoteNotifications()`, Token als Hex-Text (klein),
    `POST /api/push/apns` mit `deviceName: "iPhone-App"`, danach `PATCH /api/me/settings` `{notifications: {enabled: true}}`. Ablehnung:
    Hinweis auf iOS-Einstellungen → Reisebuch → Mitteilungen, Schalter bleibt aus.
  - Ausschalten: `DELETE /api/push/apns` `{token}`, `notifications.enabled` bleibt.
  - „Testnachricht senden“ (`POST /api/push/test`): alle ok → „Gesendet, sollte gleich ankommen.“, sonst je Gerät eine Zeile
    („iPhone-App: HTTP 410 Unregistered“, „Browser: ok“).
  - Fehler von `didFailToRegister…` und vom Server erscheinen rot im Bereich, nie als Dialog. Satz zur Web-App als Fußzeile.
  - Beim Start (angemeldet, Schalter an, Erlaubnis erteilt): Token neu holen und schicken. Hat es sich geändert, wird das alte abgemeldet.
    Schalter und letztes Token in `UserDefaults`.
  - Abmelden: erst `DELETE /api/push/apns` (Fehler still), dann wie bisher.
- **Teil B, Empfangen** (`AppDelegate` in `Push.swift`, eingebunden über `@UIApplicationDelegateAdaptor`): `willPresent` →
  `[.banner, .sound, .list]`. Antippen: `userInfo["url"]` `/trips/<id>` → `reisebuch://trip/<id>` → `AppSession.handle(url:)` (derselbe
  Weg wie beim Widget). Andere oder fehlende `url` öffnet nur die App. Kein Badge, nichts gespeichert.
- Session und PushController gehören jetzt dem App-Delegate (statt `@State` in `ReisebuchApp`), damit sie beim Kaltstart durch eine
  Mitteilung schon da sind. `AppSession.onLocalLogout` setzt den Schalter auch nach einem 401 zurück.
- **Tests** (`ReisebuchTests/PushTests.swift`, neu, 4): Hex-Umwandlung, `url` → Reise (`/trips/abc` → `abc`; `/`, leer, nil, `/trips/`,
  `/trips/abc/items`, fremde Formen → keine), Antippen setzt `pendingTripId`, Text der Testnachricht. **23/23 grün.** Gegenprobe: Hex groß
  und `/trips/abc/items` zugelassen → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- Nach dem Abmelden ist der Schalter aus; nach erneutem Anmelden muss er wieder eingeschaltet werden (das Token gehörte dem alten Konto).
- „Testnachricht senden“ ist auch bei ausgeschaltetem Schalter nutzbar (der Server sendet auch an Browser).
- Ist der Server nicht erreichbar, zeigt der Bereich „Server nicht erreichbar.“ und keinen Schalter.
- Die Mitteilungsmethoden laufen mit Completion-Handler auf dem Hauptthread: die zuerst gebaute `async`-Variante brachte die App beim
  Antippen im Simulator zum Absturz („Call must be made on main thread“). Gefunden im Simulator, behoben, erneut geprüft.

## Prüfung im Simulator (Beispielserver im Scratchpad, erfundene Daten, nicht im Repo)
- Wegwerf-UI-Tests (gelöscht), Protokoll des Beispielservers:
  - Einschalten: Erlaubnis-Dialog → `POST /api/push/apns` (Token 160 Hex-Zeichen, `deviceName` „iPhone-App“) →
    `PATCH /api/me/settings {"notifications": {"enabled": true}}`.
  - Testnachricht: „Gesendet, sollte gleich ankommen.“; mit Fehlerantwort: „iPhone-App: HTTP 410 Unregistered“.
  - App neu gestartet: Schalter an, `POST /api/push/apns` erneut.
  - Ausschalten: `DELETE /api/push/apns`. Wieder an, dann Abmelden: `DELETE /api/push/apns` vor `POST /api/auth/logout`.
  - `GET /api/push/apns` → `enabled: false`: nur der Satz, kein Schalter.
- `xcrun simctl push` mit `{"aps":{"alert":{"title":"⚓ Alle an Bord in 1 h",…}},"url":"/trips/t1"}`:
  - App beendet, Banner auf dem Home-Bildschirm angetippt → App startet, Ablauf „Lissabon Beispiel“ offen.
  - App offen (Reiseliste): Banner erscheint → angetippt → Ablauf offen.
- **Nicht prüfbar** auf dem Mac: echte Zustellung durch Apple an das iPhone (braucht den APNs-Schlüssel auf dem Server und das Gerät).
  Antippen auf dem Sperrbildschirm im Simulator nicht geprüft (dort öffnet ein Tipp per UI-Test nicht).

## Build-Ergebnis
Grün (Clean Build, Tests, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log. Verbleibend nur die bekannte Meldung
`appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).

## IPA
- `ios/Installation/0.4.0-b4/Reisebuch-0.4.0-b4.ipa`, 492 772 Bytes, App und Widget je 0.4.0 (4).
- SHA256: `a7abe8f1cf30023fa48dbc814932911c07fb8a27c9128ef4218f3be1ee497ac0`
- Profile:
  - App: „iOS Team Ad Hoc Provisioning Profile: de.theoldphilip.Reisebuch“ **erneuert** wegen Push (neue UUID 22d2bb98…, ersetzt
    d90aa876…), 2 Geräte, gültig bis 01.11.2027. Im Profil und in der signierten App: **`aps-environment` = `production`**, App Group nur
    `group.de.theoldphilip.Reisebuch`.
  - Widget: unverändert (a8497ea0…), ohne `aps-environment`, dieselbe App Group.
- `project.pbxproj` nach Archiv und Export unverändert (Vergleich mit Kopie vor dem Archiv).
- `0.1.0-b1` aus dem Ordner gelöscht (über Git erreichbar); es bleiben 0.2.0-b2, 0.3.0-b3, 0.4.0-b4.

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (nur Version 0.4.0 / Build 4, 8 Vorkommen je Schlüssel)
- `ios/Reisebuch/Reisebuch/`: `APIClient.swift`, `AppSession.swift`, `ReisebuchApp.swift`, `SettingsView.swift`, `Reisebuch.entitlements`
  (Philip), neu `Push.swift`
- `ios/Reisebuch/ReisebuchTests/PushTests.swift` (neu)
- `ios/Installation/0.4.0-b4/` (neu), `ios/Installation/0.1.0-b1/` (gelöscht), `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- f50540c iOS 0.4.0: Benachrichtigungen über APNs (der Absturz-Fix beim Antippen ist darin enthalten)
- c3c6b5b iOS 0.4.0 (4): STAND, Auftrag abgeschlossen
- 8a4f319 iOS 0.4.0 (4): IPA signiert, 0.1.0 entfernt (Push von Claude blockiert, Philip pusht)

## Rückmeldung Philip (iPhone, 0.4.0-b4)
- Erste Testnachricht scheiterte mit `BadEnvironmentKeyInToken` (APNs-Schlüssel galt nicht für Production). Philip hat einen neuen
  Schlüssel erzeugt und auf dem Server eingetragen (`APNS_SANDBOX` nicht gesetzt). Danach: Testnachricht kommt an. App-Seite unverändert.

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: Schalter nach Abmelden aus (siehe Entscheidungen).

## Was Philip auf dem iPhone testen soll
1. IPA 0.4.0-b4 installieren, App mit VPN öffnen. Der APNs-Schlüssel muss auf dem Server eingerichtet sein.
2. Einstellungen → Benachrichtigungen → „Auf diesem iPhone“ einschalten → Erlauben. Danach „Testnachricht senden“: Ergebnistext und
   Mitteilung „🔔 Reisebuch“ kommen an (auch bei offener App als Banner).
3. „Testnachricht senden“ tippen und die App sofort ganz schließen (nach oben wischen). Mitteilung antippen → App öffnet.
   Bei einer Erinnerung zu einer Reise öffnet das Antippen deren Ablauf (auch vom Sperrbildschirm).
4. Schalter aus → keine Mitteilungen mehr an dieses iPhone. In der App abmelden → das iPhone ist am Server abgemeldet.
