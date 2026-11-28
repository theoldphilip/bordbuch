# AUFTRAG-0.9.0.md: Alle Reiter und Einstellungen wie in der Web-App, Benutzerverwaltung (iOS-Auftrag 9)

Version **0.9.0, Build 9** (Regel 2: App, Widget, Teilen-Erweiterung gleich, 10 Vorkommen je Schlüssel). Erst beginnen, wenn
**0.8.0 gepusht** ist; dann ohne Rückfrage weiter mit diesem Auftrag.

Philip vermisst die übrigen Menüpunkte der Web-App und die Benutzerverwaltung. Ziel: Nach 0.9.0 kann Philip alles, was die Web-App kann,
auch in der App. **Vorbild ist die Web-App** (lesen, nicht ändern): `<repo>/web/src/pages/Trip.tsx` (Reiter `timeline`, `cruise`,
`costs`, `docs`, `share`), `components/CostsTab.tsx`, `CruiseForms.tsx`, `InviteDialog.tsx`, `<repo>/web/src/invite.ts`,
`<repo>/web/src/pages/Settings.tsx` mit allen Unterseiten in `pages/settings/`. Texte, Reihenfolge und Regeln von dort übernehmen.
Vertrag: `<repo>/docs/API.md`. Keine Server-Änderung nötig.

**Keine Prüfung im Simulator** (Philips Entscheidung): nur Build und Unit-Tests, Philip prüft auf dem iPhone.

## Teil 0: Vorher
Trennungsprüfung, `git pull --rebase origin main`, `git config user.email` = noreply. Keine neue Capability.
Zuerst eine kurze Liste in `STAND.md`: Welche Reiter und Einstellungen der Web-App die App nach 0.8.0 schon hat, welche fehlen.
Alles Fehlende aus den Teilen A und B bauen.

## Teil A: Reiter in der Reise
Oben in der Reise Reiter wie `Trip.tsx` (segmentiert oder Tab-Leiste, auf schmalen Geräten lesbar):
1. **Ablauf** (vorhanden).
2. **Kreuzfahrt** (nur wenn `trip.kind == cruise` oder Kreuzfahrten vorhanden): Übersicht wie `CruiseTab` (Schiff, Reederei, Kabine,
   Buchung, Preis und Zahlung, Tage mit Hafen, Zeiten, Alle an Bord, Tender, Zusatzinfos). Bearbeiten über die Formulare aus 0.6.0.
   Hier auch **„Kreuzfahrt anlegen“** (`POST /trips/:id/cruises` wie `CruiseForms.tsx`, mit Tagen), falls noch keine da ist.
3. **Kosten** wie `CostsTab.tsx` aus `GET /trips/:id/costs`: Summen **je Währung, nie umgerechnet**, nach Art gruppiert, bezahlt/offen,
   Anzahlung, Fälligkeit (überfällig hervorgehoben), Liste „Ohne Preis“. Antippen öffnet den Eintrag bzw. die Kreuzfahrt. Offline aus dem Cache.
4. **Dokumente** (vorhanden aus 0.7.0, als Reiter statt Knopf oben).
5. **Teilen** wie `ShareTab` in `Trip.tsx`: Mitglieder mit Rolle (Besitzer, Bearbeiter, Betrachter). Besitzer: Rolle ändern
   (`PUT /trips/:id/members/:userId`), entfernen (`DELETE`, Bestätigung), Mitglied hinzufügen aus `GET /users` (wer noch nicht dabei ist).
   Jeder (außer dem letzten Besitzer, Regeln wie Web): **„Reise verlassen“** (`DELETE …/members/<eigene id>`, Bestätigung, zurück zur Liste).
   Ein Satz, was die Rollen dürfen (Text wie Web).

## Teil B: Einstellungen wie `Settings.tsx`
Die Einstellungen der App werden eine Liste mit denselben Bereichen wie die Web-App (Symbol, Titel, Untertitel), Admin-Bereiche nur für
`user.isAdmin`. Bisherige Inhalte der App (Server, Benachrichtigungen, Erinnerungen am Ort, KI aus 0.8.0, Abmelden) ordnen sich ein.
1. **Konto** (`Profile.tsx`): Anzeigename ändern, Passwort ändern (aktuelles + neues zweimal) → `PATCH /me`; Server-Adresse; Abmelden.
2. **Zeitbedarf** (`Pace.tsx`): Name der Funktion **„Persönlicher Zeitbedarf“**, Schalter, Faktor (1 bis 4), Zusatzminuten (0 bis 120) →
   `PATCH /me/settings {pace}`; Beispielrechnung wie Web („30 min normal, 45 min persönlich“). **Keine** Begründung, kein Personenname im
   Text (feste Regel des Projekts). Nach dem Speichern Abläufe neu laden (Puffer-Hinweise ändern sich).
3. **Erinnerungen** (`Notifications.tsx`): alle Einstellungen unter `notifications` aus `GET /me/settings` (Vorlauf, Arten, Gate-Änderungen
   `infoChange` usw., genau die Felder, die die Web-App zeigt) → `PATCH /me/settings`. Dazu die bisherigen App-Schalter („Auf diesem
   iPhone“, Testnachricht, „Erinnerungen am Ort“ mit „Geplant“). Liste der Geräte des Kontos aus `GET /push/status` (Browser und
   iPhone-App), nur lesend. Der Satz „… stellst du in der Web-App ein“ entfällt.
4. **Dieses Gerät** (statt der Home-Bildschirm-Anleitung `Device.tsx`, die nur für die Web-App gilt): Stand der Erlaubnisse
   (Mitteilungen, Standort, Kamera, Hintergrundaktualisierung) mit Knopf „In iOS-Einstellungen öffnen“, Offline-Stand (Zahl der
   gespeicherten Reisen, Größe, Knopf „Offline-Daten neu laden“). Zertifikat wie `Certificate.tsx`: Stand anzeigen; Admin kann ein
   Zertifikat hochladen, wenn die Web-App das anbietet (gleiche Aufrufe).
5. **Familie** (nur Admin, `Family.tsx`), die **Benutzerverwaltung**:
   - Liste aller Konten (`GET /users`): Anzeigename, Benutzername, Admin-Zeichen.
   - **Neues Konto**: Anzeigename, Benutzername, Passwort (Knopf „Vorschlagen“ wie `generatePassword` in `invite.ts`), „Ist Admin“ →
     `POST /users`. Danach **Einladung** wie `InviteDialog.tsx`/`inviteText`: Text mit Server-Adresse der App, Benutzername, wahlweise
     Passwort, bearbeitbar, Teilen über das iOS-Teilen-Menü (`ShareLink`) oder Kopieren.
   - **Passwort zurücksetzen** (`POST /users/:id/password`, mit Vorschlag und Einladung wie oben).
   - **Löschen** (`DELETE /users/:id`) mit Bestätigung und dem Satz aus der Web-App, dass Reisen, die nur diesem Konto gehören, an den Admin
     übergehen. Das eigene Konto ist nicht löschbar.
   - Passwörter nie speichern oder protokollieren; sie stehen nur im Formular und im Einladungstext.
6. **KI und Dokumente** (aus 0.8.0, hier eingeordnet, Admin wie Web).
7. **Über Reisebuch** (`About.tsx`): Version und Build der App, Server-Version, Build-Zeit und Datenbank-Stand (`GET /api/version`),
   Hinweis, wenn der Server älter ist als die App erwartet, sofern die Web-App so etwas zeigt.

## Teil C: Prüfen
- Build grün für alle Targets, keine Warnungen (auch Archiv-Log).
- Unit-Tests: Sichtbarkeit der Reiter (Kreuzfahrt nur bei Kreuzfahrt), Kosten je Währung ohne Umrechnung und „überfällig“, Rechte im
  Reiter Teilen (wer ändern, entfernen, verlassen darf; letzter Besitzer), Admin-Bereiche nur für Admin, Beispielrechnung Zeitbedarf
  (gleich wie Web, Aufrunden auf 5 min), Passwort-Vorschlag (Länge/Zeichen wie `invite.ts`), Einladungstext mit und ohne Passwort,
  PATCH-Bodies für `/me` und `/me/settings`. Gegenprobe.
- **IPA ist freigegeben** nach `ios/Installation/0.9.0-b9/`, letzte drei behalten, Profile wie bisher.
- `STAND.md` mit der Vorher-Liste aus Teil 0, was jetzt da ist, und „Was Philip testen soll“ (jeder Reiter, jede Einstellung, Konto anlegen,
  Einladung teilen, Passwort zurücksetzen, Konto löschen mit einem Testkonto), „Neu in 0.9.0“ in `ios/CLAUDE.md`, Auftrag nach
  `ios/Auftraege/`, committen, pull, push.
