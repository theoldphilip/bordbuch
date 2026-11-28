# CLAUDE.md – Übergabe und Arbeitsbriefing für Reisebuch (Repository „bordbuch“)

> **Claude Code auf dem Mac (iPhone-App unter `ios/`): Diese Datei ist nicht dein Briefing.** Für dich gilt `ios/CLAUDE.md`. Server, Web,
> SSH zur Synology und Updates sind nicht deine Aufgabe; alles außerhalb von `ios/` ist für dich nur zum Lesen.

Stand: 28.11.2026, App-Version 0.12.0, Datenbank-Stand 10, 159 Server-Tests grün. Diese Datei ist die vollständige Übergabe aus
einer früheren Claude-Code-Sitzung (Cloud, Web). Wer sie liest, setzt die Arbeit dort fort, wo sie aufgehört hat. Lies sie ganz,
bevor du etwas änderst, und prüfe Aussagen über Code im Repo nach, statt dich auf diese Datei zu verlassen (Code gewinnt).

## 1. Worum es geht

**Reisebuch** (intern „bordbuch“) ist ein selbst betriebener Reiseplaner für eine Familie, gebaut für **Kreuzfahrten mit An- und
Abreise** und inzwischen auch **Städtetrips/Urlaub** und **Rundreisen mit Stationen**. Es läuft als **ein Docker-Container auf der
Synology** des Auftraggebers und ist nur über **WireGuard-VPN** erreichbar (nie aus dem Internet). Bedient wird es als Web-App/PWA
auf dem iPhone (Home-Bildschirm). Später soll eine **native iOS-App (SwiftUI)** dieselbe API nutzen (siehe `docs/API.md`).

- Auftraggeber und Tester: **Philip** (IT-Administrator, kein Entwickler, testet auf dem iPhone, schickt Screenshots, nutzt den
  „persönlichen Zeitbedarf“, siehe Abschnitte 2 und 4).
- Repository: `https://github.com/theoldphilip/bordbuch` (privat), Hauptzweig `main`. Du hast Push-Zugriff über den Remote `origin`.
- Betrieb: Synology 172.16.10.1, Ordner `/volume1/docker/bordbuch`, Port 8080 (HTTP) und über den DSM-Reverse-Proxy
  `https://172.16.10.1:8444` (selbst erzeugtes Zertifikat „Bordbuch“, CN=Bordbuch, läuft laut DSM am 22.02.2029 ab). Port 8443
  belegt Vaultwarden. Der KI-Schlüssel steht nur in `/volume1/docker/bordbuch/.env` auf der Synology, **nie** im Repo oder in der
  Sandbox: deshalb ist in der Cloud-Sandbox **kein echter KI-Aufruf möglich** (siehe Abschnitt 9).
- **Update auf der Synology:** Claude spielt es **nur auf Philips ausdrücklichen Wunsch** ein, nie automatisch nach einem Commit.
  Zugang (eingerichtet 23.11.2026, nur in der HolyClaude-Umgebung): SSH als `rootadmin@172.16.10.1` mit eigenem Schlüssel
  `~/.claude/ssh-bordbuch/id_ed25519` und `UserKnownHostsFile=~/.claude/ssh-bordbuch/known_hosts`. Der Schlüssel ist per
  `command=…,restrict` auf das Root-Skript `/volume1/docker/bordbuch-update.sh` festgelegt (sudo-Regel `/etc/sudoers.d/bordbuch-update`)
  und kennt nur `update` (git pull --ff-only, `docker compose up -d --build`, danach `/api/version`), `status` und `logs`. Nach dem
  Update Version und `builtAt` in der Antwort prüfen und Philip nennen. Ein DSM-Update kann die sudo-Regel entfernen; dann fragt sudo
  nach einem Passwort und Philip muss sie neu anlegen. Ohne diesen Zugang macht Philip das Update selbst:
  `cd /volume1/docker/bordbuch && sudo git pull && sudo docker compose up -d --build`. Danach zeigt Einstellungen → „Über Reisebuch“
  Version und Datenbank-Stand; ist die App auf dem iPhone älter, hilft dort „App neu laden“.

## 2. Zusammenarbeit (verbindlich)

- **Sprache:** Deutsch, kurz und sachlich, wie ein Zettel an einen Kollegen. Keine Marketing-Sprache, keine Ausrufezeichen, kein
  „perfekt!“. Fachbegriffe, Code und Fehlermeldungen bleiben im Original. Erkläre das Was und das Warum, nicht jede Zeile Code.
- **Kleine Schritte, ehrliche Berichte:** Sag, was getestet ist, und vor allem, was **nicht** geprüft werden konnte (siehe Abschnitt 9).
  Melde Fehler und Unsicherheit offen. Ist etwas erledigt und verifiziert, sage es schlicht, ohne Abschwächung.
- **Wünsche umsetzen:** Philip formuliert oft als Frage („kannst du …“). Das ist meist ein Auftrag. Bei echter Unklarheit (Umfang,
  Namen, Logo, Reiseart) stelle gezielt Rückfragen, sonst entscheide mit sinnvollem Standard und nenne die Entscheidung.
  Er schreibt „ende für heute“, wenn Schluss ist; dann nichts Neues beginnen, nur sauber abschließen.
- **Dokumentation (Vorliebe von Philip, gilt wenn er ausdrücklich eine Dokumentation verlangt):** immer exakt dasselbe Layout und
  Inhaltsverzeichnis (Generator: `docs/tools/make_doc.py`) und **immer fragen**, ob es einen erklärenden, nicht technischen Teil für
  die Geschäftsführung geben soll (dann beginnt das Dokument mit diesem Teil). Bisher gewählt: nur „Bedienung und Betrieb“, PDF,
  ohne Geschäftsführungsteil. Frage trotzdem jedes Mal.
- **Git:** Direkt auf `main` committen und pushen (`git pull --rebase origin main` vor dem Push). **Kein Force-Push, keine
  Historie umschreiben, kein Pull-Request ohne Auftrag.** Commit-Meldungen auf Deutsch, mit Version in der Betreffzeile; hänge die
  Attributionszeilen an, die deine Sitzung vorgibt. Commit/Push nur mit grünen Tests und gebauter Web-App.
- **Version bei jeder Änderung hochzählen:** Datei `VERSION` (einzige Quelle), dazu `npm version X.Y.Z --no-git-tag-version` in
  `server/` und `web/` (Test `server/test/version.test.ts` prüft den Gleichstand und den Datenbank-Stand). Kleine Fehler =
  Patch, neue Funktion = Minor. Der Datenbank-Stand (Anzahl Migrationen in `server/src/db.ts`) steht in `version.test.ts`.
- **Datenschutz:** Keine E-Mail-Adresse, Token, Schlüssel oder private Daten in Repo, Commits, Logs oder Anfragen an externe Dienste.
  Eine Sicherheitsregel in der Sitzung blockiert Befehle, die die E-Mail-Adresse des Auftraggebers enthalten: nie verwenden. Der
  Push-Kontakt `PUSH_SUBJECT` bleibt neutral. Hinweis: Ein früher Commit (1491eb4) enthält eine private Adresse; Philip hat das
  Umschreiben der Historie abgelehnt, also nicht anfassen.
- **Nicht ungefragt:** Installation auf Philips Geräten, Signing/Zertifikate/Profile, Dinge nach außen veröffentlichen, Löschen
  von Daten. Bei Unumkehrbarem fragen.
- **Namensregel:** Die Funktion heißt „Persönlicher Zeitbedarf“. Philips Name und der Grund dafür stehen nie in Oberfläche, Datenbank,
  Dokumenten, Commits oder KI-Anfragen. In der Datenbank steht nur der Faktor. Bleibe dabei, auch hier.

## 3. Aufbau in Kurzfassung

Monorepo, drei Teile, ein Container (`Dockerfile`: Web bauen → Server-Abhängigkeiten → schlankes Image, Node 24 Alpine):

| Teil | Technik | Ort |
|---|---|---|
| Server | Node ≥ 22.18 führt **TypeScript direkt aus** (Type-Stripping, Imports mit `.ts`-Endung, `erasableSyntaxOnly`), Fastify 5, `node:sqlite`, zod 4, `web-push` 4, `@anthropic-ai/sdk` | `server/` |
| Web | React 19, react-router-dom 7, Vite 8, PWA (Service Worker `web/public/sw.js`) | `web/` |
| Doku/Tools | API-Beschreibung, PDF-Generator, Dev-Testserver | `docs/`, `docs/tools/`, `scripts/dev/` |

Befehle (im Repo-Stamm): `npm run install:all`, `npm test` (Server, `node --test`), `npm run typecheck`, `npm run build` (Web),
`npm run dev:server`, `npm run dev:web`. Server-Tests: `cd server && npm test`; Web: `cd web && npx tsc --noEmit && npm run build`.

**Server (`server/src`)**
- `app.ts` baut die App (`buildApp`, injizierbar: Extractor/KI, `pushSender`, Scheduler) · `index.ts` Start · `config.ts` Umgebungsvariablen
  · `db.ts` **Migrationen als Array** (`PRAGMA user_version`, aktuell 8) · `model.ts` API-Formen und Laden · `schemas.ts` zod-Schemas
  (Eintragstypen, Infos, Einstellungen, Reiseart) · `auth.ts` Anmeldung (scrypt, Bearer-Tokens, Rollen owner/editor/viewer, Admin).
- `timeline.ts` **Zeitleiste und Puffer-Prüfung** (reine Funktionen, viel Logik: Einschiffung, Ausschiffung, Hotel, Parkplatz,
  Ausflüge, Stationen, Zeitzonen-Rechnung `toInstant`, Zeitbedarf `needOf`), `warningKey` für das Quittieren.
- `place.ts` Gate/Schalter/Kofferband/Gleis · `reminders.ts` + `reminderRunner.ts` Erinnerungen nach Uhrzeit (Tick alle 30 s, Log
  gegen Doppelsenden) · `push.ts` Web-Push (VAPID in Tabelle `meta`) · `settings.ts` Einstellungen je Benutzer · `backup.ts`
  tägliche DB-Kopie · `files.ts` Uploads · `version.ts` Version und Build-Zeit.
- `ai/` KI: `anthropic.ts` (Prompts, Auslesen, Recherche mit Websuche, Reise prüfen), `schema.ts` (strukturierte Antwort),
  `normalize.ts`, `proposals.ts` (Abgleich mit Vorhandenem, Update statt Doppelt), `research.ts`, `review.ts`, `files.ts`, `types.ts`.
- `routes/` `trips`, `items`, `cruises`, `documents` (Analyse, Vorschläge, Übernehmen, Recherche), `review` (Reise prüfen),
  `attachments`, `push`, `certificate`, `auth`.
- Zugriff auf die Datenbank nur im Server; Zeitangaben sind **lokale Zeiten mit Zeitzone** (`startLocal`/`startTz`), nie UTC-Strings.

**Web (`web/src`)**: `pages/Trip.tsx` (Reise-Seite: Ablauf mit Puffer-Check, Jetzt-Markierung, Ansichtsmodus, Quittieren, Reiter),
`Trips.tsx` (Liste, „Neue Reise“), `Settings.tsx` + `pages/settings/*`; `components/` Formulare (`ItemForm`, `CruiseForms`),
`DocReview` (KI-Vorschläge prüfen), `ResearchPanel`, `TripReviewDialog`, `InfoEditor`, `KindPicker`, `InputCollector` u. a.;
`format.ts` (Formatierung, Zeitzonen-Rechnung für die Jetzt-Markierung, Typ-Listen), `types.ts` (API-Typen, **gespiegelt zu
`server/src/model.ts`/`schemas.ts`: bei API-Änderungen beide anpassen**), `hooks/`.

**Vertrag mit künftigen Clients:** `docs/API.md` beschreibt die REST-API (Bearer-Token). Feldnamen und Pfade nicht umbenennen,
ohne API.md und beide Clients mitzuziehen. `GET /api/version` und `/api/health` sind öffentlich.

## 4. Wichtige Konzepte und Entscheidungen

- **Reiseart** `trips.kind`: `cruise` (Standard, auch für alle alten Reisen), `city`, `roundtrip`. Steuert Reiter „Kreuzfahrt“,
  Eintragstypen (Landausflug nur bei Kreuzfahrt, Station nur sonst), Schnellwahl, Texte und KI-Kontext. Eine Kreuzfahrt anzulegen
  macht die Reise zur Kreuzfahrt; zwei Stationen aus einem Dokument machen aus `city` eine `roundtrip` („Automatisch erkennen“).
- **Station** = Eintragstyp `stop` (Ort, von–bis, Zeitzone). Prüfungen `stop_no_lodging`, `stop_no_transport`, `stop_overlap`.
  Eintragstyp ist ein freier String in der DB (kein CHECK), Liste in `schemas.ts` (`ITEM_TYPES`), Web `format.ts` (`ITEM_TYPES`).
- **Zusatzinfos** (`infos` JSON an Eintrag/Hafentag/Kreuzfahrt): Arten phone/emergency/email/link/text, Quelle user/document/ai/web.
  `ai` (Notrufnummern aus KI-Wissen) und `web` sind in der Oberfläche als „bitte prüfen“ markiert.
- **KI darf nie ohne Bestätigung schreiben.** Hochladen → Analyse → Vorschläge → Philip prüft → „Übernehmen“ (`apply`, validiert wie
  jede Eingabe, transaktional). Dokumentinhalt gilt als Daten, nie als Anweisung (Schutz vor Prompt-Injection, auch bei Webseiten).
  Mehrere Dateien einzeln analysieren; „zusammen auswerten“ nur für Dateien **derselben** Buchung.
- **Allgemeine Dokumente (Bord-ABC):** Kontext nennt „Schiffe dieser Reise“, die KI übernimmt nur Nummern/Hinweise des eigenen Schiffs als
  Infos an Kreuzfahrt bzw. Einschiffungstag, keine neuen Tage/Einträge.
- **Recherche (optional, Websuche)** im Prüfdialog: zweistufig (Suche mit Server-Tool, danach strukturierte Auswertung). Funde zählen nur mit
  Quelle, die wirklich in den Suchergebnissen vorkam; es werden nur Lücken gefüllt; Modus „Reiseverlauf“ (nur Kreuzfahrt) legt Tage an;
  optionaler Link wird per `web_fetch` gelesen; „Was wurde gesucht?“ zeigt Diagnose. Läuft im Hintergrund (Polling), Ergebnis im
  Analyse-JSON des Dokuments.
- **Reise prüfen** (Knopf „🔍 Prüfen“): KI-Durchsicht der ganzen Reise, nur lesend, Ergebnis je Reise gespeichert (`trip_reviews`),
  „veraltet“ sobald die Reise geändert wurde. Gesendet werden Titel/Zeiten/Orte/Anbieter/kurze Notizen, **keine** Buchungsnummern, Preise,
  Telefonnummern, Dokumente.
- **Puffer-Check** (`timeline.ts`): normale Zeiten (Flug-Anreise zum Schiff 4 h, sonst 2 h; Ausschiffung 3 h/1 h; Ausflug 30 min, privat 60,
  Tender +30; Hotel-Check-out 2 h). **Ausschiffung rechnet bei eigener Abreise ab 06:00 oder 30 min nach Ankunft des Schiffs**, nicht ab
  „Von Bord bis“ (das ist nur Limit/Slot der Reederei). Hotel-Wartehinweis entfällt, wenn vor Check-in-Öffnung ein Flug/Zug/Bus/eine Fähre startet.
- **Quittieren** (`warning_acks`): Hinweise je Reise für alle Mitglieder; Schlüssel = Hash aus Code, Eintrag und Text, ändert sich die Lage,
  kommt der Hinweis zurück. Ändert nichts am Plan.
- **Ansichtsmodus:** ab dem ersten begonnenen Punkt sperrt die Web-App Änderungen für Bearbeiter (Entsperren nur in der Sitzung,
  `sessionStorage`). Einträge/Tage bleiben lesbar mit Anrufen. Prüfen und Quittieren bleiben aktiv. Reine Oberflächenfunktion, der Server sperrt nicht.
- **Jetzt-Markierung/Ausgrauen** (`Trip.tsx`, `useNow`): Berechnung im Browser mit Zeitzonen der Einträge.
- **Gate/Schalter/Kofferband/Gleis:** in `details` (`terminal`, `checkinDesk`, `gate`, `baggageBelt`, `platform`, `desk`); fett im Ablauf; Abflug-
  Erinnerung nennt sie; **Push an die anderen Mitglieder** bei Änderung (36 h voraus bis 8 h zurück), je Person abschaltbar (`infoChange`).
- **Reisetag-Abfrage** (`server/src/ai/placeLookup.ts`, `routes/placeLookup.ts`, Web `PlaceLookupPanel.tsx` im Eintragsdialog): sucht für EINEN Flug,
  Zug oder Mietwagen gezielt auf Live-Seiten (Flughafen, Airline, Bahn) nach den Ortsfeldern, wenige Suchen (web_search max 5, web_fetch max 3),
  Funde nur mit Quelle aus der Suche, kein Durchforsten allgemeiner Seiten. An die KI gehen nur Flug-/Zugnummer, Airline, Von/Nach, Datum und
  bisherige Ortsfelder. Ergebnis nur im Speicher; gespeichert wird per `PATCH` erst mit „Übernehmen“ (löst den Push aus). Für Bearbeiter, auch im
  Ansichtsmodus (wie Quittieren). Philip will das ausdrücklich so: am Reisetag gezielt abfragen, nicht das Internet durchforsten.
- **Währung:** keine Annahme „CHF“. Ohne Währung zeigt die App nur den Betrag; neue Einträge starten mit der zuletzt benutzten Währung.
  Die KI setzt `currency` nur aus dem Dokument (€ → EUR …), sonst null.
- **Kosten** (`server/src/costs.ts`, Reiter „Kosten“ in `web/src/components/CostsTab.tsx`, `GET /api/trips/:id/costs`): Summen je Währung, nie
  umgerechnet, gruppiert nach Art; bezahlt/offen aus `paymentStatus` (`open`/`deposit`/`paid`/null = keine Angabe, zählt als offen),
  `paidAmount` (nur bei `deposit`, sonst speichert der Server null) und `dueDate`. Die Kreuzfahrt hat einen eigenen Gesamtpreis (`cruises.cost`),
  den die KI aus der Buchung liest. Den Zahlungsstand liest die KI nur bei Einträgen (nur wenn ausdrücklich genannt, Anzahlung höchstens der
  Preis), und zwar als `details`-Einträge `paymentStatus`/`paidAmount`/`dueDate`, die `normalize.ts` herauszieht. **Grenze der KI-Antwort:**
  Das Schema in `ai/schema.ts` darf nicht wachsen; mit sechs zusätzlichen Feldern lehnte die API in 0.10.0 jede Analyse ab („The compiled grammar
  is too large“). Neue Angaben gehören in `details`. Ein Test schreibt die Felder fest. Beim Aktualisieren
  aus einem Dokument werden Preis und Zahlungsstand nur gefüllt, wenn noch nichts eingetragen ist (`mergeItem`, Kreuzfahrt in `documents.ts`). „Ohne Preis“
  listet nur gebuchte Leistungen (`PRICED_TYPES`). Preisfelder im Web gemeinsam in `MoneyFields.tsx` (Einträge und Kreuzfahrt).
- **Zeitbedarf:** Faktor und Zusatzminuten je Benutzer; alle Mindestzeiten werden damit gerechnet, Meldungen zeigen **immer beide Zeiten**
  („30 min normal, 45 min persönlich“). Erinnerungen werden um den Zeitbedarf früher gesendet.
- **Push/HTTPS:** iOS erlaubt Web-Push nur ab 16.4, aus der Home-Bildschirm-App, über HTTPS mit vertrautem Zertifikat. Das Zertifikat lädt
  die App öffentlich unter `GET /api/certificate`, Admin lädt es unter Einstellungen hoch. GPS-Erinnerungen im Hintergrund sind mit einer
  Web-App unmöglich (Grund für die iOS-App).
- **Name/Logo:** Anzeigename „Reisebuch“, Logo Kompass (`web/public/icon.svg`, PNGs randvoll für iOS). Interne Namen (Repo, Ordner,
  Container, Datenbankdatei `bordbuch.db`, Speicherschlüssel `bordbuch.*`, Zertifikat-CN) bleiben „bordbuch“, weil sonst Updates und
  gespeicherte Daten brechen.

## 5. Stand der Funktionen (nach Versionen)

0.1 Grundlage (Reisen, Kreuzfahrt, Einträge, Puffer-Check, Familie/Rollen, PWA, Push, HTTPS-Setup, KI-Dokumente, Zusatzinfos, Zeitbedarf,
Einstellungen mit Unterseiten, Einladung per Teilen-Menü) · 0.2 Versionsanzeige · 0.3 Recherche, Layout-Fix lange Namen · 0.4 Reiseverlauf,
Link, Diagnose · 0.5 Reise prüfen · 0.6 Reisearten, Stationen, Umbenennung Reisebuch, Jetzt-Markierung, Ausschiffung ab 06:00, Bord-ABC,
Währung · 0.7 Quittieren, Ansichtsmodus · 0.8 Gate/Schalter/Kofferband/Gleis, Push bei Änderung, Kabine sichtbar · 0.8.1 Update auf der
Synology durch Claude · 0.9 Kostenauswertung (Reiter „Kosten“, Preis an der Kreuzfahrt, Zahlungsstand und Fälligkeit) · 0.10 KI liest
Zahlungsstand aus Dokumenten, Reisetag-Abfrage für Gate/Schalter/Kofferband/Gleis · 0.10.1 Dokument-Analyse wieder lauffähig (KI-Schema zu
groß, Zahlungsstand nur noch bei Einträgen über details) · 0.11 Push für die iPhone-App über APNs (Server-Teil) · 0.11.1 Linux-Tool `scripts/mint/reisebuch-ipa.sh` (neueste IPA
laden, SHA-256 prüfen, per USB installieren, README-Abschnitt) · 0.12 Dokument-Analyse im Hintergrund (`?background=1`, 202, danach Mitteilung
mit `documentId` an den Hochladenden) für die Teilen-Erweiterung der iPhone-App. Details in der
Tabelle „Seit der ersten Fassung neu“ des PDFs und in `git log`.

## 6. Offene Punkte (Reihenfolge nach Philips Wünschen)

1. **Kosten pro Person** (später, von Philip erwähnt). Umrechnung in eine Währung bewusst nicht gebaut (bräuchte Wechselkurse).
2. **Notizen-Seite** (Vorschlag aus dem Chat, nicht bestellt): Reiter mit freiem Text/Checkliste, auch Platz für Packliste. Notizen gibt es heute
   an Reise („Bearbeiten“), Eintrag, Reisetag und als Eintragstyp „Notiz“.
3. **Native iOS-App (SwiftUI)** gegen dieselbe API, geplant in Etappen: (1) Lesen/Unterwegs inkl. Offline, (2) APNs-Push + Standort-Erinnerungen
   + Widget, (3) Bearbeiten, Dokumente, Share-Extension. Philip hat einen Apple-Developer-Account und kennt eine Arbeitsweise mit einem Mac über
   Remote Control. Server-Teil APNs ca. 0,5 Tag. **Begonnen am 27.11.2026** nach dem Muster von Philips Repo `gym-native`: diese Sitzung ist
   der **Architekt** (schreibt `ios/AUFTRAG-<Version>.md`, beantwortet Rückfragen als Nachtrag im Auftrag, liest `ios/STAND.md`), Claude Code
   auf dem Mac mini baut nach `ios/CLAUDE.md` und pusht. Entscheidungen von Philip: App unter `ios/` in diesem Repo, Backups nur über Git (kein
   Backup-Ordner), vorerst nur iPhone (keine Watch), Bundle-ID `de.theoldphilip.Reisebuch`. **Ganz wichtig für Philip:** Der Mac legt ein
   eigenes, neues Projekt an und darf nie in das Gym-Projekt schreiben; jeder Auftrag beginnt mit der Trennungsprüfung aus `ios/CLAUDE.md`.
   iOS-Version zählt unabhängig von `VERSION` (Server/Web). Erledigt und von Philip auf dem iPhone geprüft: 0.1.0 bis 0.4.0 (Lesen, offline,
   Reisetag-Abfrage, Widget, APNs-Push). Am 28.11.2026 auf einmal bestellt („alles zusammen“), der Mac arbeitet sie nacheinander ab:
   `ios/AUFTRAG-0.5.0.md` Erinnerungen am Ort (lokale Mitteilungen mit `UNLocationNotificationTrigger`, Standort bleibt auf dem Gerät,
   Background fetch), `0.6.0` Bearbeiten (Reisen, Einträge, Kreuzfahrt, Quittieren, Ansichtsmodus wie Web), `0.7.0` Dokumente, Vorschläge
   prüfen, Teilen-Erweiterung `ReisebuchShare` (Token per App Group im Schlüsselbund, Upload mit `?background=1`, braucht Server 0.12.0).
   Philip installiert IPAs selbst mit `scripts/mint/reisebuch-ipa.sh`.
4. Kleinere Wünsche: Dokument an mehrere Einträge hängen, „automatisch übernehmen wenn sicher“, Bordzeit vs. Ortszeit, Packliste (siehe README-Roadmap).
5. **Vom Auftraggeber zu klären/prüfen:** Beträge, die früher auf „CHF“ gespeichert wurden (vor 0.6.4 wurde beim Öffnen eines Eintrags
   ohne Währung „CHF“ gesetzt); Kabinennummer (laut Screenshot der Buchung 12076) im Reiter „Kreuzfahrt“ prüfen und ggf. eintragen.

## 7. Prüfen und Testen (so wurde bisher gearbeitet)

- **Server:** `cd server && npm test` (node:test, alles ohne Netz; Fake-Extractor und Fake-PushSender über `buildApp`-Optionen). Neue Logik bekommt
  Tests; wichtige Prüfungen immer mit **Gegenprobe** (Logik absichtlich ausbauen, Test muss rot werden, dann zurück).
- **Web:** `cd web && npx tsc --noEmit && npm run build`. Browser-Test mit **Playwright (Chromium)**: `scripts/dev/fake-server.ts` startet die echte App mit
  Fake-KI und leerer Datenbank (`node --experimental-strip-types scripts/dev/fake-server.ts`, Port 8091, `npm run build` vorher), Beispiel
  `scripts/dev/browser-check.cjs` (iPhone-Emulation, **gefälschte Uhr** per `ctx.clock.install`, Daten über die API anlegen, Aussagen per
  `console.log`, Screenshots ansehen). Breite prüfen: `document.documentElement.scrollWidth` muss `innerWidth` (390) entsprechen.
- **CSS-Falle:** einspaltige Raster brauchen `grid-template-columns: minmax(0, 1fr)`, sonst weiten lange Namen die Seite (am Ende von `styles.css`
  gesammelt). Globale `input`-Stile sind volle Breite: Checkboxen explizit klein setzen.
- **PDF-Doku:** `python3 docs/tools/make_doc.py` (reportlab + DejaVu), Inhaltsverzeichnis muss auf **eine Seite** passen; keine Emojis im PDF
  (Schrift hat sie nicht). Nach Funktionsänderungen die Doku nachziehen, wenn Philip es verlangt oder es zugesagt war.
- **Docker-Image prüfen** (optional): in der Sandbox ist der Daemon aus (`dockerd &`), TLS läuft über einen Proxy: temporäre Dockerfile-Kopie, die
  `/root/.ccr/ca-bundle.crt` ins Image kopiert (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `npm_config_cafile`), `docker build --network host`,
  danach `GET /api/version` im Container prüfen (`builtAt` nicht null). Temporäre Dateien nicht committen.

## 8. Konfiguration (Umgebungsvariablen, Container)

`ANTHROPIC_API_KEY` (leer = KI aus), `AI_MODEL` (Standard `claude-opus-5-5`; Fallback-Beta `server-side-fallback-2026-07-01` außer bei Haiku),
`DEFAULT_TZ` (Europe/Zurich), `MAX_UPLOAD_MB` (25), `BACKUP_KEEP` (14), `DATA_DIR`, `WEB_DIR`, `PORT`, `HOST`, `PUSH_SUBJECT`
(Standard `mailto:bordbuch@example.com`), `APP_VERSION`/`BUILD_TIME` (aus dem Image). **APNs** für die iPhone-App (seit 0.11.0, `server/src/apns.ts`):
`APNS_KEY` (`.p8` als base64 oder PEM), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (Standard `de.theoldphilip.Reisebuch`), `APNS_SANDBOX=1` nur für
Builds aus Xcode; nur in der `.env` der Syno, nie im Repo. Ohne Schlüssel ist nur der App-Push aus. Zustellung an alle Geräte eines Benutzers über
`deliverToUser` in `push.ts` (Web-Push und APNs), Tabelle `apns_devices` (Datenbank-Stand 10). Daten liegen in `./data` (Datenbank, `uploads/`,
`backups/`, Zertifikat), gehört nicht ins Git (`.gitignore`).

## 9. Was bisher NICHT mit echten Diensten geprüft wurde

Die Sandbox hat keinen API-Schlüssel und kein iPhone. Alles Folgende ist nur mit Fake-Antworten und Tests abgesichert; beim ersten echten Lauf
aufmerksam nachfragen und Philips Rückmeldung (Screenshots) ernst nehmen:
- Websuche/`web_fetch` der Recherche (Server-Tools `web_search_20260209`/`web_fetch_20260209`, Auswertung, Quellenprüfung),
- Qualität von „Reise prüfen“, Bord-ABC-Filter, Gate/Schalter-Auslesen, Stationen aus Rundreise-Programmen, Währungserkennung,
- echter Web-Push auf dem iPhone (inkl. Push bei Gate-Änderung), Zertifikatsvertrauen unter iOS,
- Verhalten über mehrere Tage/Zeitzonen (Jetzt-Markierung, Ansichtsmodus),
- ob die KI den Gesamtpreis einer Kreuzfahrt und den Zahlungsstand (Anzahlung, Fälligkeit) aus echten Buchungsbestätigungen richtig liest,
- ob die Reisetag-Abfrage echte Live-Seiten findet und lesen kann (Abflugtafeln sind oft per JavaScript geladen; dann findet sie nichts),
  und wie lange sie mit echtem Modell dauert.
Bekannte Eigenheiten: Der Ansichtsmodus ist nur Oberfläche; Notrufnummern aus KI-Wissen sind unzuverlässig und gekennzeichnet; Erinnerungen werden
nach 5 Minuten Verspätung nicht mehr gesendet.

## 10. Erste Schritte in einer neuen Sitzung

1. `git pull`, diese Datei und `README.md` lesen, `git log --oneline -10` ansehen.
2. `npm run install:all`, `cd server && npm test` (sollte 159 grün sein), `cd web && npm run build`.
3. Philip begrüßen, kurz den Stand nennen (Server 0.12.0; iPhone-App siehe `ios/STAND.md`) und fragen, was als Nächstes dran ist. Ohne Auftrag nichts ändern.
