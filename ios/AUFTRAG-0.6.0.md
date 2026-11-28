# AUFTRAG-0.6.0.md: Bearbeiten in der App (iOS-Auftrag 6)

Version **0.6.0, Build 6** (Regel 2, App und Widget gleich). Zweiter von drei Aufträgen (siehe Kopf von `AUFTRAG-0.5.0.md`): erst
beginnen, wenn 0.5.0 gepusht ist. Keine neue Capability nötig.

Bisher ist die App lesend (einzige Ausnahme: „Übernehmen“ der Reisetag-Abfrage). Jetzt kann Philip unterwegs Reisen und Einträge anlegen,
ändern und löschen, ohne die Web-App. **Vorbild ist die Web-App**: Felder, Vorbelegungen und Texte aus
`<repo>/web/src/components/ItemForm.tsx`, `KindPicker.tsx`, `MoneyFields.tsx`, `InfoEditor.tsx`, `CruiseForms.tsx` und
`<repo>/web/src/pages/Trip.tsx` übernehmen (lesen, nicht ändern). Vertrag: `<repo>/docs/API.md` „Reisen“, „Kreuzfahrten“, „Einträge“,
„Hinweise quittieren“, „Kosten“.

## Teil 0: Vorher
Trennungsprüfung, `git pull --rebase origin main`, `git config user.email` = noreply.

## Teil A: Rechte, Ansichtsmodus, offline
- Bearbeiten nur mit Rolle `owner` oder `editor` (`role` aus `GET /trips/:id`); Löschen der Reise nur `owner`. Für `viewer` keine Knöpfe.
- **Ansichtsmodus wie in der Web-App** (`Trip.tsx`, `locked = isEditor && started && !unlocked`): Ab dem ersten begonnenen Punkt der Reise
  sind die Bearbeiten-Knöpfe versteckt; ein Knopf „Bearbeiten entsperren“ hebt das bis zum Beenden der App auf (nur im Speicher, nicht
  gespeichert). Quittieren und Reisetag-Abfrage bleiben immer möglich.
- **Offline** (Band „Offline · Stand …“ sichtbar oder Anfrage scheitert): nicht speichern, Hinweis „Offline, Änderung nicht gespeichert.“,
  Eingaben im Formular bleiben stehen. Keine Warteschlange.
- Nach jedem erfolgreichen Speichern oder Löschen: Ablauf neu laden, Cache, Widget und Erinnerungen am Ort aktualisieren (wie nach
  jedem Laden).
- Fehler des Servers (400 mit Klartext) im Formular anzeigen, nicht als Dialog.

## Teil B: Reisen
- Reiseliste: Knopf **„Neue Reise“**: Titel (Pflicht), Reiseart (`cruise`/`city`/`roundtrip`, Texte wie Web), Beginn/Ende optional →
  `POST /trips`, danach die neue Reise öffnen.
- In der Reise: **„Reise bearbeiten“** (Titel, Reiseart, Beginn, Ende, Notizen) → `PATCH /trips/:id` nur mit geänderten Feldern.
- **„Reise löschen“** (nur `owner`): Bestätigungsdialog, der den Titel nennt und sagt, dass Einträge und Dokumente mit gelöscht werden →
  `DELETE /trips/:id`, zurück zur Liste.

## Teil C: Einträge
- Im Ablauf **„+“**: Auswahl der Art wie `KindPicker.tsx` (Landausflug nur bei Kreuzfahrt, Station nur sonst), dann das Formular.
- Formular (neu und bearbeiten), Felder wie `ItemForm.tsx`: Titel, Beginn und Ende (Datum, Uhrzeit optional, **Zeitzone** je Zeitpunkt),
  Ort, Anbieter, Buchungsnummer, Preis/Währung/Zahlungsstand/Anzahlung/Fälligkeit (wie `MoneyFields.tsx`; Anzahlung nur bei „Anzahlung“),
  Notizen, bei Landausflug der Hafentag (`cruiseDayId`), dazu die üblichen `details` der Art (API.md „Einträge“) und die Ortsfelder
  (Terminal, Schalter, Gate, Kofferband, Gleis).
- **Zeiten:** lokale Zeit + IANA-Zeitzone, nie UTC. Vorbelegung der Zeitzone wie in der Web-App (z. B. vom vorigen Eintrag, sonst
  `defaultTimezone` der Timeline). Auswahl der Zeitzone mit Suche. Datum ohne Uhrzeit ist erlaubt (`2027-05-08`).
- **Währung:** keine Annahme „CHF“; neue Einträge starten mit der zuletzt benutzten Währung (wie Web), sonst leer.
- **`details` verlustfrei:** Das Formular kennt nur einen Teil der Schlüssel. Beim Speichern immer **alle** bisherigen `details` mitschicken
  und nur die geänderten Schlüssel ersetzen (wie beim „Übernehmen“ der Reisetag-Abfrage). Unbekannte Schlüssel bleiben erhalten.
- **Zusatzinfos** (`infos`): Liste bearbeiten wie `InfoEditor.tsx` (Bezeichnung, Wert, Art phone/emergency/email/link/text). Einträge mit
  `source` `ai`/`web` behalten ihre Quelle, solange sie nicht geändert werden; neue bekommen `user`.
- Speichern: neu `POST /trips/:id/items`, ändern `PATCH /items/:id` (nur geänderte Felder, `details` komplett, siehe oben).
- **Löschen** im Detail: Bestätigung, `DELETE /items/:id`.
- Hinweis: Ändert Philip Gate/Schalter/Gleis, schickt der Server den anderen Mitgliedern eine Mitteilung. Das passiert von selbst.

## Teil D: Kreuzfahrt
- Schiffsdaten bearbeiten (Schiff, Reederei, Kabine, Buchungsnummer, Notizen, Preis und Zahlung) → `PATCH /cruises/:id`.
- Tage: bearbeiten (Art, Hafen, Land, Zeitzone, Ankunft, Abfahrt, Alle an Bord, Tender, Notizen) → `PATCH /cruise-days/:id`; hinzufügen
  → `POST /cruises/:id/days`; löschen mit Bestätigung → `DELETE /cruise-days/:id`. Bei `disembarkation` heißt `departure` „Von Bord bis“.
- Eine Kreuzfahrt neu anlegen bleibt in der Web-App (meist über ein Dokument); in der App nicht nötig.

## Teil E: Hinweise quittieren
- Im Hinweis-Kasten je Hinweis **„Quittieren“** bzw. „Quittierung zurücknehmen“ (`PUT`/`DELETE /trips/:id/warnings/:key/ack`, Rolle
  editor). 404 = Hinweis nicht mehr aktuell: Ablauf neu laden. Wenn das in 0.1.0 schon gebaut ist: nur prüfen und in `STAND.md` sagen.

## Teil F: Prüfen
- Build grün, keine Warnungen (auch Archiv-Log).
- Unit-Tests: Zusammenführen der `details` (unbekannte Schlüssel bleiben, leeres Feld entfernt den Schlüssel), nur geänderte Felder im
  `PATCH`, Zeit + Zeitzone als Text (`2027-05-08T09:40` bzw. nur Datum), Anzahlung nur bei „Anzahlung“, Ansichtsmodus-Regel. Gegenprobe.
- **Keine Prüfung im Simulator** (Philips Entscheidung vom 28.11.2026): keine Klick-Tests, kein Beispielserver, keine UI-Tests. Build und
  Unit-Tests bleiben Pflicht. Philip prüft auf dem iPhone; deshalb `STAND.md` → „Was Philip testen soll“ besonders genau.
- **IPA ist freigegeben** nach `ios/Installation/0.6.0-b6/`, letzte drei behalten, Profil wie bisher.
- `STAND.md` („Was Philip testen soll“: neue Reise, Eintrag anlegen/ändern/löschen, Gate ändern und Mitteilung bei einem anderen
  Mitglied, Ansichtsmodus), „Neu in 0.6.0“ in `ios/CLAUDE.md`, Auftrag nach `ios/Auftraege/`, committen, pull, push. Dann weiter mit
  `AUFTRAG-0.7.0.md`.
