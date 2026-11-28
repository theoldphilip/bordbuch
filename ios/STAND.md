# STAND (iOS), 28.11.2026

Auftrag: `ios/AUFTRAG-0.9.0.md` (0.9.0, Build 9), erledigt und nach `ios/Auftraege/` verschoben. Rückgabe zu 0.8.0 steht in der
Git-Historie dieser Datei.

## Trennungsprüfung (Ausgabe der Befehle, gekürzt)
```
git rev-parse --show-toplevel  -> /Users/philippleissner/Projekte/bordbuch
git remote get-url origin      -> https://github.com/theoldphilip/bordbuch.git
pwd                            -> /Users/philippleissner/Projekte/bordbuch/ios
ls <repo>                      -> CLAUDE.md docker-compose.yml Dockerfile docs ios package.json README.md scripts server VERSION web
git ls-files | grep -ci gym    -> 0
```
Ergebnis: bestanden. `git config user.email` → `noreply@anthropic.com`. Keine neue Capability, Entitlements unverändert.

## Teil 0: Vorher-Liste (Stand nach 0.8.0, verglichen mit `Trip.tsx` und `Settings.tsx`)
| Web-App | App nach 0.8.0 | jetzt (0.9.0) |
|---|---|---|
| Reiter Ablauf | da | da |
| Reiter Kreuzfahrt (Übersicht, anlegen) | nur Bearbeiten über das Menü „…“, keine Übersicht, kein Anlegen | Reiter mit Übersicht, Anlegen mit Route |
| Reiter Kosten | fehlte | Reiter |
| Reiter Dokumente | Knopf oben im Ablauf | Reiter |
| Reiter Teilen (Mitglieder, Rollen, verlassen) | fehlte | Reiter |
| Einstellungen Konto (Name, Passwort, Abmelden) | nur Anzeige und Abmelden | Name und Passwort ändern, Server, Abmelden |
| Zeitbedarf | fehlte | da |
| Erinnerungen (Vorlauf, Arten, Gate-Änderungen, Geräte) | nur Push-Schalter und Test, Hinweis „in der Web-App einstellen“ | alle Felder, Geräte, Push, Erinnerungen am Ort |
| Dieses Gerät / Zertifikat | fehlte | Erlaubnisse, Offline-Daten, Zertifikat (Admin: hochladen, entfernen) |
| Familie (Benutzerverwaltung, Einladung) | fehlte | da (nur Admin) |
| KI und Dokumente | da (0.8.0) | eingeordnet |
| Über Reisebuch | nur App- und Server-Version | App, Server, Build-Zeit, Datenbank-Stand, Adresse |

## Was ich getan habe
- **Reiter in der Reise** (`TripTimelineView.swift`, `TripTabs.swift`): Leiste unter dem Titel (waagrecht scrollbar, auf schmalen Geräten
  lesbar): Ablauf, Kreuzfahrt (nur bei Reiseart Kreuzfahrt oder vorhandener Kreuzfahrt), Kosten, Dokumente (mit Zahl und 📥, wenn
  Vorschläge warten), Teilen. „+“ (neuer Eintrag) nur im Ablauf; „🔍 Prüfen“ und „…“ überall.
  - **Kreuzfahrt:** je Kreuzfahrt Schiff, Kabine, Reederei, Buchung, Preis/Zahlung/Fälligkeit, Notizen, Zusatzinfos, Route mit Datum,
    Art, Hafen/Land, An/Ab („Von Bord bis“ bei Ausschiffung), An Bord, Tender, 📌 Zahl der Einträge am Tag. Tag antippen → Detail (mit
    Bearbeiten). „Bearbeiten“, „+ Reisetag“, ohne Kreuzfahrt „Kreuzfahrt anlegen“, sonst „+ Weitere Kreuzfahrt (Back-to-Back)“. Anlegen wie
    `CruiseForms.tsx` mit Route (Einschiffung/Ausschiffung mit Hafen und Zeitzone, Seetage dazwischen, höchstens 120 Nächte) →
    `POST /trips/:id/cruises`.
  - **Kosten** aus `GET /trips/:id/costs`: je Währung Summe, bezahlt, offen, „ohne Angabe zählt als offen“, Gruppen nach Art
    (aufklappbar mit Einträgen), „Noch zu zahlen“ mit „überfällig seit …“ (rot) bzw. „bis …“, „Ohne Währung“, „Ohne Preis“. Nichts wird
    umgerechnet. Antippen öffnet den Eintrag bzw. wechselt zum Reiter Kreuzfahrt. Offline aus dem Zwischenspeicher (`cache/costs-<id>.json`,
    mit Band „Offline · Stand …“).
  - **Dokumente:** die Liste aus 0.7.0/0.8.0 als Reiter.
  - **Teilen:** Mitreisende mit Rolle (Besitzer, Bearbeiten, Nur ansehen; „(du)“). Besitzer: Rolle ändern (Auswahl), entfernen (wischen,
    Bestätigung), hinzufügen aus `GET /users` (wer noch nicht dabei ist, Rolle Bearbeiten/Nur ansehen). „Reise verlassen“ für jeden außer
    dem letzten Besitzer (Bestätigung, danach zurück zur Liste). Satz zu den Rollen.
- **Einstellungen** (`SettingsView.swift` neu aufgebaut): Liste mit Symbol, Titel, Untertitel wie `Settings.tsx`.
  1. **Konto:** Anzeigename, aktuelles Passwort, neues Passwort zweimal → `PATCH /me` (Passwort nur, wenn ein neues eingegeben ist;
     vorher geprüft: gleich, mindestens 8 Zeichen); „Gespeichert. Andere Geräte wurden abgemeldet.“; Server-Adresse; Abmelden.
  2. **Persönlicher Zeitbedarf:** Schalter, Faktor (× 1,25 … × 3), Zusatzzeit (keine … + 60 min) → `PATCH /me/settings {pace}`,
     Beispiel „Aus einer empfohlenen Zeit von 30 min werden 45 min“ (wie Web, aufgerundet auf 5 min). Danach Abläufe neu laden.
     Kein Name, keine Begründung im Text.
  3. **Erinnerungen:** Push „Auf diesem iPhone“ und Testnachricht; die Regeln aus `notifications` wie die Web-App (Alle an Bord, Ausflug,
     Abfahrt mit Vorlauf, Gate/Schalter/Kofferband/Gleis geändert, Abflug-Vorlauf; „Mit deinem persönlichen Zeitbedarf: … min vorher“),
     nur sichtbar, wenn Benachrichtigungen fürs Konto an sind (wie Web); „Erinnerungen am Ort“ mit „Geplant“; angemeldete Geräte aus
     `GET /push/status` (lesend). Der Satz „… in der Web-App einstellen“ ist weg.
  4. **Dieses Gerät:** Stand der Erlaubnisse (Mitteilungen, Standort, Kamera, Hintergrundaktualisierung) mit „In iOS-Einstellungen
     öffnen“; Offline-Stand (gespeicherte Reisen, Größe, „Offline-Daten neu laden“); Zertifikat aus `GET /certificate/info` (für wen, gültig
     bis, Warnung unter 60 Tagen); Admin: hochladen (`.pem`/`.crt`/`.cer` → `PUT /certificate`), entfernen mit Bestätigung.
  5. **Familie** (nur Admin): Konten mit Benutzername und Admin-Zeichen; „Neues Konto“ (Benutzername, Anzeigename, Startpasswort mit
     „Vorschlagen“, „Ist Admin“) → `POST /users`, danach **Einladung**: Text wie `inviteText` mit Server-Adresse der App, Benutzername,
     wahlweise Passwort, Adresse und Text bearbeitbar, „Teilen …“ (iOS-Teilen-Menü) und „Kopieren“. „Passwort“ je Konto (Vorschlag,
     `POST /users/:id/password`, danach dieselbe Einladung). Löschen durch Wischen, Bestätigung mit dem Satz der Web-App; das eigene Konto ist
     nicht löschbar. Passwörter stehen nur im Formular und im Einladungstext.
  6. **KI und Dokumente:** aus 0.8.0 eingeordnet.
  7. **Über Reisebuch:** App-Version und Build, Server-Version, Build-Zeit, Datenbank-Stand, Adresse.
- Benutzer-ID kommt aus Anmeldung bzw. `GET /me` (`AppSession.userId`, für „du“ und „Reise verlassen“); `TripDetail` liest jetzt
  `members`.
- **Tests** (`ReisebuchTests/SettingsLogicTests.swift`, neu, 9): Reiter (Kreuzfahrt nur bei Kreuzfahrt), Kosten je Währung ohne
  Zusammenzählen und „überfällig“, Rechte im Reiter Teilen (ändern, entfernen, hinzufügen, verlassen, letzter Besitzer, Kandidaten),
  Admin-Bereiche, Zeitbedarf (wie Web inkl. Aufrunden, aus), Passwort-Vorschlag (3 × 4 Zeichen aus dem Alphabet von `invite.ts`),
  Einladungstext mit und ohne Passwort, PATCH-Bodies für `/me` (Passwort nur bei neuem) und `/me/settings`, Route der Kreuzfahrt.
  **59/59 grün.** Gegenprobe: letzter Besitzer darf verlassen und Zeitbedarf ohne Aufrunden → 2 Tests rot, danach zurückgestellt.

## Entscheidungen / Abweichungen
- „KI und Dokumente“ ist für alle sichtbar (Stand), die Einrichtung nur für Admins. In der Web-App ist der ganze Bereich nur für Admins.
- „Reise verlassen“ auch für Besitzer, solange es einen weiteren Besitzer gibt (Auftrag); die Web-App zeigt es nur Nicht-Besitzern.
- Der Satz zu den Rollen ist neu formuliert; die Web-App hat dafür keinen Text.
- „Über Reisebuch“ zeigt keinen Hinweis „App veraltet“: Die iPhone-App hat eine eigene Versionsnummer, ein Vergleich mit dem Server
  ergibt keinen Sinn (die Web-App vergleicht ihr eigenes Bündel mit dem Server).
- Server-Adresse unter „Konto“ nur angezeigt; eine andere gibt man nach dem Abmelden bei der Anmeldung ein.
- Der Einladungstext ist der der Web-App (Anleitung für Safari/Web-App), auch aus der iPhone-App.

## Build-Ergebnis
Grün für App, Widget, Erweiterung und Tests (Debug Simulator, Release-Archiv), keine Compiler-Warnungen, auch nicht im Archiv-Log.
Verbleibend nur `appintentsmetadataprocessor … No AppIntents.framework dependency found` (Build-Werkzeug).
**Keine Prüfung im Simulator** (Philips Entscheidung), nur Build und Unit-Tests. Keine der neuen Ansichten ist gesehen.

## IPA
- `ios/Installation/0.9.0-b9/Reisebuch-0.9.0-b9.ipa`, 1 393 891 Bytes, App, Widget und Erweiterung je 0.9.0 (9).
- SHA256: `ca3149d4c935f1f9ab4436a4cf12b5ba8bb3d3a7a213c4d1821dd52b25049acb`
- Profile unverändert: App 22d2bb98… (`aps-environment` = `production`), Widget a8497ea0…, Erweiterung c018dd7d…, alle 2 Geräte, gültig
  bis 01.11.2027, App Group nur `group.de.theoldphilip.Reisebuch`. `project.pbxproj` nach Archiv und Export unverändert.
- Im Ordner 0.7.0-b7, 0.8.0-b8, 0.9.0-b9; 0.6.0-b6 entfernt.

## Geänderte Dateien
- `ios/Reisebuch/Reisebuch.xcodeproj/project.pbxproj` (nur Version 0.9.0 / 9, 10 Vorkommen je Schlüssel)
- `ios/Reisebuch/Reisebuch/`: neu `SettingsLogic.swift`, `TripTabs.swift`; neu aufgebaut `SettingsView.swift`; geändert
  `TripTimelineView.swift`, `DocumentsView.swift`, `EditForms.swift` (Kreuzfahrt anlegen), `Models.swift`, `AppSession.swift`,
  `ResponseCache.swift`
- `ios/Reisebuch/ReisebuchTests/SettingsLogicTests.swift` (neu)
- `ios/Installation/`, `ios/STAND.md`, `ios/CLAUDE.md`, Auftrag verschoben

## Commits (Hashes)
- e9ba941 iOS 0.9.0: Alle Reiter und Einstellungen wie in der Web-App
- folgende: STAND 0.9.0, IPA 0.9.0

## Offene Fragen an den Architekten
- Keine zwingenden. Zur Kenntnis: die Abweichungen oben.

## Was Philip auf dem iPhone testen soll
Vorher: IPA 0.9.0-b9 installieren. Für Familie ein Testkonto verwenden und danach löschen.
1. **Reiter:** In einer Kreuzfahrt-Reise oben Ablauf · Kreuzfahrt · Kosten · Dokumente · Teilen; in einem Städtetrip ohne „Kreuzfahrt“.
2. **Kreuzfahrt:** Übersicht prüfen (Kabine, Preis, Route mit An/Ab/An Bord, Tender). Tag antippen → Detail → „Bearbeiten“. In einer
   Test-Reise ohne Kreuzfahrt (Art Kreuzfahrt) „Kreuzfahrt anlegen“ mit Einschiffung/Ausschiffung → die Tage erscheinen, dazwischen Seetage.
3. **Kosten:** Summen je Währung wie in der Web-App, „Noch zu zahlen“ mit „überfällig“ (rot), „Ohne Preis“. Einen Eintrag antippen.
   VPN aus → Kosten erscheinen mit Band „Offline · Stand …“.
4. **Teilen:** Als Besitzer das Testkonto hinzufügen (Rolle „Nur ansehen“), Rolle ändern, entfernen (nach links wischen). Als Mitglied
   einer fremden Reise „Reise verlassen“ → zurück zur Liste.
5. **Konto:** Anzeigename ändern → Liste/Fußzeile zeigt ihn. Passwort ändern (aktuelles + neues zweimal).
6. **Zeitbedarf:** Schalter an, Faktor × 1,5 → Beispiel „45 min“; im Ablauf zeigen Hinweise beide Zeiten.
7. **Erinnerungen:** Vorlauf „Alle an Bord“ ändern; in der Web-App dieselbe Einstellung sehen. Geräteliste zeigt Browser und iPhone-App.
8. **Dieses Gerät:** Erlaubnisse stimmen mit den iOS-Einstellungen überein; „Offline-Daten neu laden“; Zertifikat-Stand.
9. **Familie** (Admin): Neues Konto „test“ mit „Vorschlagen“ → Einladung erscheint → „Teilen …“ (z. B. an dich selbst per Nachricht),
   Schalter „Startpasswort“ aus → Text ändert sich. „Passwort“ beim Testkonto → neue Einladung. Testkonto löschen (wischen, Bestätigung
   nennt die Übergabe der Reisen). Das eigene Konto hat keinen Löschen-Knopf.
10. **Über Reisebuch:** App 0.9.0 (Build 9), Server-Version, Build-Zeit, Datenbank-Stand.
