# Bordbuch

Reiseplaner für die Familie, gebaut für **Kreuzfahrten mit Vor- und Nachprogramm**.
Self-hosted als ein Docker-Container (z. B. auf einer Synology), erreichbar per VPN.

## Was Bordbuch anders macht

- **Phasen statt einer flachen Liste:** Der Ablauf gliedert sich automatisch in
  *Vorprogramm → Kreuzfahrt → (Zwischenprogramm) → Nachprogramm*. Die Zuordnung ergibt sich aus
  den Zeiten. Back-to-Back-Kreuzfahrten werden unterstützt.
- **Kreuzfahrt als Route:** Jeder Tag ist eine Einschiffung, ein Hafentag, ein Seetag oder eine
  Ausschiffung, jeweils mit Ankunft, Abfahrt, *Alle an Bord*, Tenderhafen und Zeitzone des Hafens.
- **Puffer-Check** (auf dem Server berechnet, also für Web und iOS identisch):
  - Anreise: Landet der Flug rechtzeitig vor *Alle an Bord*? Hinweis bei Anreise am Einschiffungstag.
  - Abreise: Reicht die Zeit zwischen Ausschiffung und Rückflug?
  - Landausflüge: Rückkehr vor *Alle an Bord*, mit größerem Puffer bei privaten Ausflügen und Tenderhäfen.
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
- [ ] Buchungsbestätigungen per E-Mail importieren
- [ ] Bordzeit vs. Ortszeit (Schiffe stellen die Uhr nicht immer auf Ortszeit um)
- [ ] Erinnerungen (z. B. 60 min vor *Alle an Bord*)
- [ ] Packliste & Kostenübersicht pro Person
