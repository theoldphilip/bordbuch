# Bordbuch

Reiseplaner für die Familie, gebaut für **Kreuzfahrten mit An- und Abreise** (Flug, Bahn, eigenes Auto, Parkplatz, Übernachtung, Transfer).
Self-hosted als ein Docker-Container (z. B. auf einer Synology), erreichbar per VPN.

## Was Bordbuch anders macht

- **Phasen statt einer flachen Liste:** Der Ablauf gliedert sich automatisch in
  *Anreise → Kreuzfahrt → (Zwischenprogramm) → Abreise*. Die Zuordnung ergibt sich aus
  den Zeiten. Back-to-Back-Kreuzfahrten werden unterstützt.
- **An- und Abreise mit allen Bausteinen:** Flug, Zug, Transfer (Taxi, Shuttle, Bahn), Übernachtung vor/nach der Kreuzfahrt,
  **Parkplatz** (mit Einfahrt, Ausfahrt, Kennzeichen, Shuttle) und Mietwagen. Beide Phasen sind auch leer sichtbar und
  bieten Schnellauswahl-Buttons.
- **Kreuzfahrt als Route:** Jeder Tag ist eine Einschiffung, ein Hafentag, ein Seetag oder eine
  Ausschiffung, jeweils mit Ankunft, Abfahrt, *Alle an Bord*, Tenderhafen und Zeitzone des Hafens.
- **Puffer-Check** (auf dem Server berechnet, also für Web und iOS identisch):
  - Anreise: Landet der Flug rechtzeitig vor *Alle an Bord*? Hinweis bei Anreise am Einschiffungstag.
  - Abreise: Reicht die Zeit zwischen Ausschiffung und Rückflug?
  - Hotel: Check-out gegenüber *Alle an Bord*, Wartezeit bis Check-in, doppelt bezahlte Nächte während der Kreuzfahrt, späte Ankunft.
  - Parkplatz: Ist er bis zur Rückkehr gebucht?
  - Landausflüge: Rückkehr vor *Alle an Bord*, mit größerem Puffer bei privaten Ausflügen und Tenderhäfen.
- **Dokumente automatisch zuordnen (KI):** Buchungsbestätigung, Ticket, Rechnung oder Reiseplan hochladen. Die KI liest das Dokument,
  erkennt Flug, Hotel, Parkplatz, Transfer, Ausflug oder die Kreuzfahrt-Route, legt die Einträge an (oder ergänzt vorhandene) und hängt das
  Dokument daran. Du bestätigst vorher jeden Vorschlag. Siehe [KI-Einrichtung](#dokumente-automatisch-zuordnen-ki).
- **Dokumente** (Bordkarten, Tickets, Vouchers) pro Reise oder pro Eintrag.
- **Teilen** mit Familienmitgliedern (Besitzer / Bearbeiten / Nur ansehen).
- **PWA:** Lässt sich auf den iPhone-Homescreen legen. Zuletzt geladene Reisen sind auch offline lesbar.

## Installation auf der Synology

Voraussetzung: **Container Manager** (DSM 7.2+) ist installiert.

1. Den Ordner `bordbuch` (dieses Repository) nach `/volume1/docker/bordbuch` kopieren,
   z. B. per File Station oder `git clone`.
2. Im Container Manager unter **Projekt → Erstellen**:
   - Pfad: `/volume1/docker/bordbuch`
   - Quelle: *Vorhandene docker-compose.yml verwenden*
   - Den Build starten. Das Image wird direkt auf der Syno gebaut, für Intel und ARM.
3. Im Browser `http://<syno-ip>:8080` öffnen und das **Administrator-Konto** anlegen.
4. Unter *Einstellungen → Familie* weitere Konten anlegen.
5. Auf dem iPhone in Safari öffnen, dann *Teilen → Zum Home-Bildschirm*.

**Zugriffsrechte:** Falls der Container nicht in `./data` schreiben darf, in der
`docker-compose.yml` die Zeile `user: "UID:GID"` aktivieren. Die passenden Werte des
DSM-Benutzers liefert per SSH der Befehl `id <benutzername>`.

**Zugriff von unterwegs:** Über das VPN der Syno (VPN Server / WireGuard / Tailscale).
Der Port muss **nicht** ins Internet freigegeben werden.

**Update:** Neue Version in den Ordner kopieren, dann im Container Manager *Projekt → Erstellen*
(neu bauen). Die Daten in `./data` bleiben erhalten.

### Dokumente automatisch zuordnen (KI)

Funktioniert mit der Claude-API von Anthropic. Ohne API-Schlüssel ist die Funktion aus, alles andere läuft normal.

**Ablauf:** *Dokumente → Hochladen – KI ordnet zu*. Nach etwa 10 bis 60 Sekunden erscheint der Prüfbildschirm mit den Vorschlägen:
neuer Eintrag, Aktualisierung eines vorhandenen Eintrags (gleiche Buchungsnummer, Flugnummer oder Titel am gleichen Tag),
oder die Route einer Kreuzfahrt. Du kannst jeden Vorschlag bearbeiten, überspringen oder übernehmen. **Es wird nichts gespeichert,
bevor du bestätigst.** Das Dokument hängt danach am ersten übernommenen Eintrag. Unlesbare oder fehlgeschlagene Dokumente bleiben
im Posteingang (*Dokumente → Zu prüfen*) und lassen sich erneut analysieren.

**Einrichten**
1. Auf https://console.anthropic.com einen API-Schlüssel erzeugen (Abrechnung nach Verbrauch).
2. Auf der Syno per SSH die Datei `.env` neben der `docker-compose.yml` anlegen. Der Schlüssel wird dabei nicht angezeigt und landet
   nicht im Shell-Verlauf:

```bash
read -rsp "API-Schlüssel: " K; echo; printf 'ANTHROPIC_API_KEY=%s\n' "$K" | sudo tee /volume1/docker/bordbuch/.env >/dev/null; sudo chmod 600 /volume1/docker/bordbuch/.env; unset K
```

3. Container neu starten, damit er den Schlüssel liest:

```bash
cd /volume1/docker/bordbuch && sudo docker compose up -d
```

4. In Bordbuch unter *Einstellungen → Dokumente automatisch zuordnen (KI)* auf **Verbindung testen** tippen.

Die Datei `.env` ist von Git und aus dem Docker-Image ausgeschlossen. Der Schlüssel gehört nie ins Repository.

**Modell wählen:** Standard ist `claude-opus-5-5` (am genauesten). Günstiger sind `claude-sonnet-5-5` und `claude-haiku-5-5`. Zum Ändern in
der `.env` eine Zeile `AI_MODEL=claude-sonnet-5-5` ergänzen und den Container neu starten. Die Listenpreise stehen bei Anthropic;
pro Dokument ist mit einigen Cent zu rechnen (Schätzung, abhängig von Seitenzahl und Modell). Auf https://console.anthropic.com kannst du
ein Ausgabenlimit setzen.

**Unterstützte Dateien:** PDF (bis 20 MB), Fotos als JPG, PNG, WebP, GIF (bis 5 MB) und E-Mails oder Text (`.eml`, `.txt`, `.html`).
Nicht lesbar sind HEIC-Fotos, Apple-Wallet-Dateien (`.pkpass`) und Word-Dokumente. Sie werden trotzdem gespeichert, nur nicht analysiert.

**Datenschutz:** Beim Analysieren wird der Inhalt des Dokuments (inklusive Namen und Buchungsnummern) über das Internet an Anthropic
gesendet. Die Syno braucht dafür ausgehenden HTTPS-Zugriff auf `api.anthropic.com`. Dokumente, die du ohne KI hochlädst (Einstellung
ohne Schlüssel), verlassen den Server nicht.

**Zur Sicherheit:** Text im Dokument wird als Daten behandelt, nicht als Anweisung. Alles, was die KI liefert, wird vom Server wie
jede andere Eingabe geprüft und nur mit deiner Bestätigung gespeichert.

### Daten & Backup

| Pfad | Inhalt |
|---|---|
| `data/bordbuch.db` | SQLite-Datenbank |
| `data/uploads/` | hochgeladene Dokumente |
| `data/backups/` | tägliche, konsistente DB-Kopie (die letzten 14) |

Für Hyper Backup reicht es, `data/backups/` und `data/uploads/` zu sichern.

### Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | HTTP-Port im Container |
| `DATA_DIR` | `/data` | Datenverzeichnis |
| `DEFAULT_TZ` | `Europe/Zurich` | Zeitzone für Einträge ohne eigene Zeitzone |
| `MAX_UPLOAD_MB` | `25` | maximale Dateigröße |
| `BACKUP_KEEP` | `14` | Anzahl aufbewahrter Tages-Backups |
| `ANTHROPIC_API_KEY` | leer | Schlüssel für die KI-Dokumentanalyse (aus `.env`) |
| `AI_MODEL` | `claude-opus-5-5` | Modell für die Dokumentanalyse |

## Entwicklung

Benötigt Node.js ≥ 22.18. Der Server läuft direkt als TypeScript, ohne Build-Schritt.

```bash
npm run install:all
npm run dev:server     # API auf :8080 (Daten in server/data)
npm run dev:web        # Web-App auf :5173 mit Proxy zur API
npm test               # Server-Tests
```

Beispieldaten: `node scripts/demo-data.mjs http://localhost:8080 <token>`

### Aufbau

```
server/   Fastify + SQLite (node:sqlite), REST-API, Puffer-Logik (src/timeline.ts)
web/      React + Vite PWA
docs/     API-Referenz (Grundlage für die iOS-App)
```

## Roadmap

- [ ] **iOS-App (SwiftUI)** mit derselben API, siehe [`docs/API.md`](docs/API.md)
      → Widgets, Live Activity „Alle an Bord in 45 min“, Offline-Cache, Push für Erinnerungen
- [ ] Buchungsbestätigungen per E-Mail weiterleiten statt hochladen
- [ ] Dokument mit mehreren Einträgen an alle Einträge hängen (heute: an den ersten)
- [ ] Automatisch übernehmen, wenn die KI sicher ist
- [ ] Bordzeit vs. Ortszeit (Schiffe stellen die Uhr nicht immer auf Ortszeit um)
- [ ] Erinnerungen (z. B. 60 min vor *Alle an Bord*)
- [ ] Packliste & Kostenübersicht pro Person
