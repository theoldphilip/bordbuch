# AUFTRAG-0.4.0.md: Benachrichtigungen über APNs (iOS-Auftrag 4)

Version **0.4.0, Build 4** (Regel 2, App und Widget gleich). Philip hat 0.3.0 (Widget) auf dem iPhone geprüft, alles in Ordnung.

Der Server kann seit **0.11.0** Erinnerungen, Gate-Änderungen und Testnachrichten auch an die iPhone-App schicken (Vertrag in `docs/API.md`,
Abschnitte „Benachrichtigungen (Web Push)“ und „iPhone-App (APNs)“). Dieser Auftrag baut die App-Seite.

## Teil 0: Vorher
1. Trennungsprüfung aus `ios/CLAUDE.md`, `git pull --rebase origin main`, `git config user.email` = noreply (Regel 7).
2. Neue Capability: legt **Philip** in Xcode an (Regel 5). Gib ihm die Anleitung, warte auf „fertig“:
   - Target **Reisebuch** → *Signing & Capabilities* → *+ Capability* → **Push Notifications**. (Nur beim App-Target, nicht beim Widget.)
   - Keine weiteren Capabilities, kein „Background Modes“.
3. Prüfen und in `STAND.md`: Die Entitlements der App enthalten jetzt `aps-environment` und weiter nur die App Group
   `group.de.theoldphilip.Reisebuch`; das Widget ist unverändert; `grep -ri GymNative ios/Reisebuch` ist leer.

## Teil A: Anmelden des Geräts

- In den Einstellungen der App ein neuer Bereich **„Benachrichtigungen“**:
  - Nur sichtbar, wenn `GET /api/push/apns` → `enabled: true`. Sonst ein ruhiger Satz: „Auf dem Server noch nicht eingerichtet.“
  - Schalter **„Auf diesem iPhone“**. Einschalten:
    1. `UNUserNotificationCenter.requestAuthorization(options: [.alert, .sound])`. Lehnt Philip ab: Hinweis, dass es in den iOS-Einstellungen
       unter Reisebuch → Mitteilungen geht; Schalter bleibt aus.
    2. `UIApplication.shared.registerForRemoteNotifications()` (über `@UIApplicationDelegateAdaptor`).
    3. Im Delegate `didRegisterForRemoteNotificationsWithDeviceToken`: Token als Hex-Text (klein) → `POST /api/push/apns`
       `{token, deviceName: "iPhone-App"}`. **Nicht** den Gerätenamen von iOS senden (der enthält oft einen Personennamen).
    4. `PATCH /api/me/settings` mit `{notifications: {enabled: true}}`. Das ist dieselbe Einstellung wie in der Web-App (gilt fürs Konto);
       ohne sie verschickt der Server keine Erinnerungen.
  - Ausschalten: `DELETE /api/push/apns` `{token}`. `notifications.enabled` bleibt unverändert (die Web-App könnte es noch brauchen).
  - Knopf **„Testnachricht senden“** (`POST /api/push/test`), Ergebnis aus `results` anzeigen: alle ok → „Gesendet, sollte gleich ankommen.“,
    sonst je Gerät „iPhone-App: HTTP 410 …“ usw.
  - Ein Satz darunter: „Wann und wofür erinnert wird (Vorlauf, Gate-Änderungen), stellst du in der Web-App unter Einstellungen →
    Erinnerungen ein.“
- **Bei jedem Start** (angemeldet, Schalter an, Erlaubnis erteilt): erneut `registerForRemoteNotifications()` und das Token schicken; Apple
  kann es ändern. Den letzten Token in `UserDefaults` merken (kein Geheimnis), um beim Abmelden das richtige abzumelden.
- **Abmelden** in der App: zuerst `DELETE /api/push/apns` `{token}` (Fehler still), dann wie bisher.
- `didFailToRegisterForRemoteNotificationsWithError`: Meldung im Bereich Benachrichtigungen, nicht als Dialog.

## Teil B: Empfangen und Antippen

- `UNUserNotificationCenterDelegate`:
  - `willPresent`: auch bei geöffneter App anzeigen (`[.banner, .sound, .list]`).
  - `didReceive` (Antippen): `userInfo["url"]` lesen. `"/trips/<id>"` → diese Reise öffnen, **gleicher Weg wie beim Widget**
    (`reisebuch://trip/<id>`), damit es nur eine Stelle gibt. Andere oder fehlende `url` → App einfach öffnen.
- Nichts speichern, kein Abzeichen (Badge) setzen.

## Teil C: Prüfen

- Build grün (App, Widget, Tests), keine Warnungen.
- Unit-Tests: Hex-Umwandlung des Tokens, Auswahl der Reise aus `url` (`/trips/abc` → `abc`; `/`, leer, fremde Form → keine).
- Simulator mit deinem Beispielserver (Scratchpad, nicht ins Repo):
  - `GET /api/push/apns` an/aus, Schalter, `POST /api/push/apns` mit Token im Protokoll, Abmelden schickt `DELETE`.
  - Antippen prüfen mit einer Datei `payload.apns` (im Scratchpad) und
    `xcrun simctl push booted de.theoldphilip.Reisebuch payload.apns`, Inhalt z. B.
    `{"aps":{"alert":{"title":"⚓ Alle an Bord in 1 h","body":"Neapel"},"sound":"default"},"url":"/trips/<id einer Beispielreise>"}`.
    Banner erscheint, Antippen öffnet die Reise.
- **Nicht prüfbar** auf dem Mac: echte Zustellung von Apple an das Gerät (braucht den Schlüssel auf dem Server, den Philip gerade einrichtet,
  und das echte iPhone). In `STAND.md` so vermerken.
- **IPA ist freigegeben**, nach `ios/Installation/0.4.0-b4/` mit `SHA256.txt`; ältere als die letzten drei Versionen aus dem Ordner löschen.
  Das Ad-hoc-Profil der App wird wegen Push erneuert: in `STAND.md` melden (Name, ob `aps-environment` = `production` im exportierten
  Profil steht; ad hoc muss `production` sein, sonst kommt nichts an). `project.pbxproj` nach dem Export unverändert.
- `STAND.md`, „Was Philip testen soll“ (Schalter an → Erlaubnis → Testnachricht; App geschlossen → Testnachricht → Antippen), „Neu in 0.4.0“
  in `ios/CLAUDE.md`, Auftrag nach `ios/Auftraege/`, committen (Identität prüfen), pull, push.
