# Reisebuch

Reiseplaner für die Familie, gebaut für **Kreuzfahrten mit An- und Abreise** (Flug, Bahn, eigenes Auto, Parkplatz, Übernachtung, Transfer).
Self-hosted als ein Docker-Container (z. B. auf einer Synology), erreichbar per VPN.

## Was Reisebuch anders macht

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
- **Kosten:** Reiter mit Summen je Währung (nie umgerechnet) und Art, bezahlt und offen, fälligen Restzahlungen und einer Liste
  gebuchter Leistungen ohne Preis. Preis, Zahlungsstand (offen, angezahlt, bezahlt) und Fälligkeit gibt es an jedem Eintrag und an der Kreuzfahrt;
  die KI liest Preise aus der Buchung, bei Einträgen auch den Zahlungsstand, wenn er ausdrücklich dasteht.
- **Reisetag-Abfrage:** Im geöffneten Flug, Zug oder Mietwagen sucht „Am Reisetag … abfragen“ gezielt auf Live-Seiten von Flughafen, Airline oder
  Bahn nach Terminal, Schalter, Gate, Kofferband oder Gleis für genau diesen Termin. Jeder Fund mit Quelle, gespeichert wird erst mit „Übernehmen“,
  auch im Ansichtsmodus.
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

**Reise direkt aus Dokumenten starten:** Unter *Neue Reise → Mit KI aus Dokumenten* wählst du mehrere Dateien aus
(Kreuzfahrt-Buchung oder Reiseplan, Flüge, Hotel, Parkplatz, Transfer, Ausflüge). Die KI liest alle, schlägt einen Reisenamen vor und
baut die Reise auf. Du prüfst die Dokumente nacheinander, die Kreuzfahrt zuerst. In der Route kannst du Schiff, Kabine und einzelne
Tage ändern oder entfernen. Landausflüge werden automatisch dem passenden Hafentag zugeordnet, egal in welcher Reihenfolge die
Dokumente ankommen. Auch in einer bestehenden, leeren Reise gibt es dafür den Knopf *Mit KI aus Dokumenten aufbauen*.

**Mehrere Dokumente, Screenshots und Text:** Im Dialog *Mit KI zuordnen* (und beim Start einer Reise) kannst du beliebig viele Dateien
auswählen oder hineinziehen, Screenshots mit **Strg+V** einfügen und Text einfügen oder eintippen. Standardmäßig wird jede Datei einzeln
gelesen, nacheinander geprüft und ihr Dokument am passenden Eintrag abgelegt. Mit *Alle zusammen als eine Unterlage auswerten* werden
mehrere Dateien gemeinsam gelesen, z. B. drei Screenshots derselben Buchungsseite. Eingefügter Text wird als `.txt`-Datei abgelegt.
**Ganze Dokumente einfügen:** Text darfst du in beliebiger Länge einfügen (bis etwa 500 000 Zeichen, das sind mehrere hundert Seiten), zum Beispiel
eine komplette E-Mail oder den Text einer Buchungsseite. Mit Strg+V nimmt der Dialog auch kopierte **Dateien** an (z. B. ein PDF aus dem
Dateimanager), solange der Browser sie in der Zwischenablage bereitstellt. Auf dem iPhone gibt es über HTTPS den Knopf **Aus Zwischenablage
einfügen**: Er liest Bilder, PDF und Text direkt aus der Zwischenablage, iOS fragt dabei einmal nach („Einfügen“). Fotos wählst du alternativ
über die Fotomediathek. Dateien, die Reisebuch nicht lesen kann (z. B. Word oder Pages, HEIC-Fotos), warnt der Dialog schon in der Liste. Sie werden
nur abgelegt. Speichere sie als PDF oder kopiere den Text.

**Zusatzinfos an jedem Reisepunkt:** Einträge, Hafentage und die Kreuzfahrt selbst haben eine Liste mit Zusatzinfos: Telefonnummern,
Notrufnummern, E-Mail, Links und Hinweise. Nummern lassen sich direkt antippen (Anrufen). Die KI übernimmt Nummern aus deinen Dokumenten
(Hotelrezeption, Hotline der Reederei, Treffpunkt-Handy) und ergänzt bei Orten die Notrufnummer des Landes aus ihrem allgemeinen Wissen.
**Diese Nummern sind als „KI-Wissen, bitte prüfen“ gekennzeichnet** und gehören nicht zu deinen Unterlagen; prüfe sie, bevor du dich darauf
verlässt. Sobald du eine solche Info bearbeitest, gilt sie als deine eigene. Im Ablauf zeigt ein Symbol (☎️ oder 🆘) am Eintrag, dass
Zusatzinfos vorhanden sind.

**Erinnerungen nach Uhrzeit** aufs iPhone (Alle an Bord, Ausflug, Abflug, Abfahrt), mit deinem Zeitbedarf als Vorlauf. Siehe
[Erinnerungen aufs iPhone](#erinnerungen-aufs-iphone-benachrichtigungen-nur-per-vpn).

**Persönlicher Zeitbedarf:** Unter *Einstellungen → Zeitbedarf* stellst du ein, ob und wie stark dein eigenes Tempo berücksichtigt wird (Faktor
und pauschale Zusatzzeit, nur für dein Konto). Alle empfohlenen Mindestzeiten des Puffer-Checks (Anreise zum Schiff, Ausschiffung,
Rückkehr von Ausflügen, Hotel-Check-out) zeigen dann **beide Zeiten**, z. B. „30 min normal, 45 min persönlich“. Eine Lage, die normal
reicht, aber mit deinem Zeitbedarf zu knapp ist, wird als „nur persönlich“ gekennzeichnet. In der Datenbank steht nur der Faktor, kein
Grund dafür, und es geht nichts davon an die KI.

**Aufbau der App:** Unten (am Computer oben) wechselst du zwischen *Reisen* und *Einstellungen*. Die Einstellungen sind eine Liste kurzer
Seiten: *Konto*, *Zeitbedarf*, *Erinnerungen*, *Dieses Gerät einrichten* und für Admins *Familie* sowie *KI und Dokumente*. Direkt nach der
ersten Anmeldung auf einem Gerät erscheint einmal ein Einrichtungsdialog mit den offenen Schritten (Zertifikat installieren, Home-Bildschirm,
Erinnerungen). Ein Abzeichen an *Dieses Gerät einrichten* zeigt, wie viele Schritte noch offen sind.

**Familienmitglieder einladen:** Unter *Einstellungen → Familie* legst du ein Konto an und kannst ein leicht abzutippendes Startpasswort
vorschlagen lassen. Danach erscheint eine fertige Einladung mit Adresse, Benutzername, Startpasswort und den ersten Schritten. Auf dem
iPhone verschickst du sie über **Teilen …** (Nachrichten, WhatsApp, Mail …); alternativ über Nachricht, E-Mail oder Kopieren. Das Teilen-Menü
gibt es nur über eine HTTPS-Adresse. Das Passwort kannst du auch weglassen und getrennt schicken. Die Einladung erscheint ebenso nach
*Passwort* (zurücksetzen).

**Jederzeit selbst ändern:** Einträge, Kreuzfahrt und einzelne Reisetage lassen sich wie bisher von Hand anlegen, ändern und löschen.
*Leeren* im Kopf von Anreise, Abreise oder Zwischenprogramm löscht alle Einträge dieses Abschnitts auf einmal (mit Rückfrage).

**Einzelne Dokumente:** *Dokumente → Hochladen – KI ordnet zu*. Nach etwa 10 bis 60 Sekunden erscheint der Prüfbildschirm mit den Vorschlägen:
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

4. In Reisebuch unter *Einstellungen → KI und Dokumente* auf **Verbindung testen** tippen.

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

### Erinnerungen aufs iPhone (Benachrichtigungen, nur per VPN)

Reisebuch kann dich **nach Uhrzeit** erinnern, auch bei geschlossener App: vor „Alle an Bord“, vor dem Beginn eines Ausflugs, vor Abflug
und vor Abfahrt von Bahn, Bus, Fähre und Transfer. Der Vorlauf ist pro Art einstellbar (*Einstellungen → Erinnerungen*) und wird
durch deinen **persönlichen Zeitbedarf** verlängert. Die Nachricht sagt dann z. B. „Alle an Bord in 1 h 30 min, Vorlauf 1 h 30 min
(normal 1 h)“. Eine Erinnerung, die der Server um mehr als 5 Minuten verpasst hat, wird nicht verspätet gesendet.

**Nicht möglich** sind Erinnerungen nach Standort im Hintergrund („du bist am Hafen“). Das erlauben iOS und Safari einer Web-App nicht, dafür
braucht es die iOS-App.

**So kommt die Nachricht zum iPhone:** Die Syno schickt sie **ausgehend** (HTTPS) an den Push-Dienst von Apple, Apple stellt sie zu. Dafür
muss nichts aus dem Internet auf die Syno zugreifen können. Die App bleibt nur über VPN erreichbar. Voraussetzungen:

1. **iOS 16.4 oder neuer**, und Reisebuch liegt **auf dem Home-Bildschirm** (Safari → Teilen → Zum Home-Bildschirm). In Safari selbst gibt es
   keine Web-Benachrichtigungen.
2. **HTTPS mit vertrauenswürdigem Zertifikat.** Eine reine `http://`-Adresse reicht nicht, iOS erlaubt Benachrichtigungen nur auf sicheren Seiten.
3. Die Syno darf ausgehend zu den Apple-Push-Servern (`*.push.apple.com`, Port 443).

**HTTPS einrichten, ohne die App ins Internet zu stellen**

*Variante A: Du erreichst die Syno schon über einen Namen mit gültigem Zertifikat* (z. B. `meinesyno.synology.me` mit Let's Encrypt):

1. **Freien Port wählen.** Hier wird `8444` verwendet. Belegte Ports zeigt `sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'`;
   `8443` ist oft schon vergeben (z. B. von Vaultwarden).
2. DSM → *Systemsteuerung → Anmeldeportal → Erweitert → Reverse-Proxy → Erstellen*.
   Quelle: Protokoll **HTTPS**, Hostname = dein Syno-Name, Port **8444**. Ziel: Protokoll **HTTP**, Hostname `localhost`, Port **8080**.
3. *Systemsteuerung → Sicherheit → Zertifikat → Einstellungen*: dem neuen Reverse-Proxy-Eintrag das gültige Zertifikat des Namens zuweisen.
4. **Port 8444 nicht im Router freigeben** und prüfen, dass keine Weiterleitung auf die Syno alles durchlässt. Damit ist Reisebuch von außen nicht erreichbar.
5. In der DSM-Firewall (*Systemsteuerung → Sicherheit → Firewall*) Port 8444 nur für dein Heimnetz und das WireGuard-Netz erlauben und für alle
   anderen Quellen verweigern. Wer will, schützt Port 8080 genauso.
6. **Test ohne iPhone** (am Computer im Heimnetz). Der Befehl erzwingt die interne Adresse und prüft dabei das Zertifikat des Namens:

```bash
curl -s --resolve meinesyno.synology.me:8444:172.16.10.1 https://meinesyno.synology.me:8444/api/health
```

   Erwartet wird `{"ok":true,…}`. Eine Zertifikatsmeldung heißt, dass in Schritt 3 das falsche Zertifikat zugewiesen ist.
7. **Der Name muss im VPN auf die interne Adresse zeigen.** Ein Synology-Name zeigt öffentlich auf deinen Anschluss, und aus dem Tunnel kommst
   du darüber oft nicht an deine eigene Syno zurück. Am einfachsten über das Paket **DNS Server** der Syno: *DNS Server → Zonen → Erstellen →
   Hauptzone*, Zonentyp „Vorwärtszone“, Domänenname = dein kompletter Syno-Name, dann einen Eintrag **A** (Name leer) auf `172.16.10.1`
   anlegen und bei den Weiterleitungen den Router oder einen öffentlichen DNS eintragen. Im WireGuard-Profil auf dem iPhone setzt du dann
   `DNS = 172.16.10.1`. Test im Tunnel: `nslookup meinesyno.synology.me 172.16.10.1`.
8. Reisebuch auf dem iPhone (mit aktivem WireGuard) über `https://meinesyno.synology.me:8444` öffnen und neu auf den Home-Bildschirm legen.

*Variante B: ohne DNS und ohne Namen* (wenn du am VPN nichts einstellen kannst). Reisebuch wird über die IP `https://172.16.10.1:8444` aufgerufen.
Dafür erzeugst du ein **eigenes Zertifikat nur für diese IP**, das du einmal auf dem iPhone als vertrauenswürdig einträgst. Es gibt keine
Zertifizierungsstelle, der Schlüssel liegt nur auf der Syno, und das iPhone vertraut genau diesem einen Zertifikat.

1. Zertifikat erzeugen (auf der Syno per SSH oder am Computer). Es ist 825 Tage gültig, länger akzeptiert iOS nicht:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout bordbuch-key.pem -out bordbuch.pem -subj "/CN=Bordbuch" -addext "subjectAltName=IP:172.16.10.1" -addext "extendedKeyUsage=serverAuth"
```

2. DSM → *Systemsteuerung → Sicherheit → Zertifikat → Hinzufügen → Neues Zertifikat hinzufügen → Zertifikat importieren*: `bordbuch-key.pem` als privaten
   Schlüssel und `bordbuch.pem` als Zertifikat wählen. Danach `bordbuch-key.pem` überall löschen, wo er nicht gebraucht wird.
3. Reverse-Proxy wie in Variante A anlegen (Port 8444, Ziel `localhost:8080`), als Hostname `172.16.10.1` (lehnt DSM die IP ab, `*`), und unter
   *Zertifikat → Einstellungen* das importierte Zertifikat zuweisen. Router und Firewall wie in A.
4. Test am Computer: `curl --cacert bordbuch.pem https://172.16.10.1:8444/api/health` muss `{"ok":true,…}` liefern.
5. **Zertifikat aufs iPhone bringen.** Am einfachsten über Reisebuch: Als Admin unter *Einstellungen → Dieses Gerät einrichten → Zertifikat verwalten* `bordbuch.pem`
   hochladen (nur das Zertifikat; einen privaten Schlüssel lehnt die App ab). Auf dem iPhone in **Safari** die normale http-Adresse im VPN
   öffnen, anmelden, unter *Einstellungen → Dieses Gerät einrichten* **Zertifikat herunterladen** antippen (oder gleich im Einrichtungsdialog nach der ersten Anmeldung), dann *Einstellungen → Profil geladen → Installieren* und unter
   *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* dem Zertifikat **vollständig vertrauen**. Alternativ die Datei als
   `bordbuch.crt` per E-Mail schicken.
6. Mit aktivem WireGuard `https://172.16.10.1:8444` in Safari öffnen, auf den Home-Bildschirm legen. Nach 825 Tagen Schritt 1 bis 5 wiederholen.

**Einschalten:** In Reisebuch (vom Home-Bildschirm geöffnet) unter *Einstellungen → Erinnerungen* **Auf diesem Gerät aktivieren**,
Mitteilungen erlauben, dann **Testnachricht senden**. Danach stellst du ein, wofür und wie früh erinnert wird.

**Logo auf dem Home-Bildschirm:** iOS liest das Symbol nur in dem Moment, in dem die Kachel angelegt wird, und merkt es sich dann. Das Logo ist
in die Seite eingebettet, damit dafür kein zweiter Abruf nötig ist. Erscheint trotzdem ein Buchstabe oder ein Seitenbild, löschst du die Kachel
(lange drücken → App entfernen) und legst sie neu an, über die HTTPS-Adresse und mit vertrautem Zertifikat.

**Fehlersuche:** Kommt die Testnachricht nicht an, steht in den Einstellungen der Grund (z. B. `HTTP 403`). Meist fehlt die HTTPS-Adresse
oder der ausgehende Zugriff der Syno. Das Protokoll siehst du im Container Manager. Für die Kennung gegenüber den Push-Diensten gibt es die
Umgebungsvariable `PUSH_SUBJECT` (Standard `mailto:bordbuch@example.com`). Setze dort bei Bedarf eine eigene Adresse in der `.env` ein,
sie wird nur an Apples Push-Dienst geschickt.

### Benachrichtigungen für die iPhone-App (APNs)

Die native iPhone-App (unter `ios/`) bekommt Erinnerungen über den Push-Dienst von Apple (APNs). Dafür braucht der Server einmalig einen
Schlüssel aus dem Apple-Developer-Account. Ohne ihn läuft alles andere normal, nur die App bekommt keine Benachrichtigungen.

1. [developer.apple.com](https://developer.apple.com/account) → *Certificates, Identifiers & Profiles* → *Keys* → `+`. Name z. B. „Reisebuch Push“,
   Häkchen bei **Apple Push Notifications service (APNs)**, *Continue*, *Register*. **Key ID** notieren und die Datei `AuthKey_<KeyID>.p8`
   herunterladen (geht nur einmal). Die **Team ID** steht oben rechts im Account.
2. Die `.p8`-Datei auf die Syno kopieren (z. B. per File Station in einen Ordner, auf den nur du Zugriff hast) und per SSH in die `.env` übernehmen.
   Der Schlüssel erscheint dabei nicht auf dem Bildschirm:

```bash
cd /volume1/docker/bordbuch
printf 'APNS_KEY=%s\n' "$(base64 < /pfad/zu/AuthKey_XXXXXXXXXX.p8 | tr -d '\n')" | sudo tee -a .env >/dev/null
printf 'APNS_KEY_ID=%s\nAPNS_TEAM_ID=%s\n' XXXXXXXXXX DEINETEAMID | sudo tee -a .env >/dev/null
sudo chmod 600 .env
```

3. Die `.p8`-Datei danach von der Syno löschen und sicher aufbewahren (Passwort-Manager). Container neu starten:
   `sudo docker compose up -d`. Im Protokoll steht „APNs eingerichtet: Push für die iPhone-App ist an.“, bei einem kaputten Schlüssel eine Warnung.

Die Ad-hoc-Versionen der App nutzen den normalen (Produktions-)Server von Apple. Nur für eine direkt aus Xcode gestartete App wäre
`APNS_SANDBOX=1` nötig. Der Schlüssel gehört nie ins Repository.

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
- [x] Erinnerungen nach Uhrzeit (Alle an Bord, Ausflug, Abflug, Abfahrt) per Web Push, siehe oben
- [ ] Erinnerungen nach Standort (nur mit der iOS-App möglich)
- [x] **Gate, Check-in-Schalter, Kofferband, Gleis** (Felder am Eintrag, hervorgehoben im Ablauf, im Abflug-Push, Push an die anderen bei Änderung)
- [x] **Kabine** gut sichtbar (im Ablauf an der Kreuzfahrt und im Reiter Kreuzfahrt)
- [x] **Hinweise quittieren** (für alle Mitglieder, gruppiert unter „Quittiert“, kommt zurück, wenn sich die Lage ändert)
- [x] **Ansichtsmodus** (ab dem ersten begonnenen Punkt sind Änderungen gesperrt, Einträge bleiben lesbar mit Anrufen; Verlassen mit Warnung, gilt bis die App geschlossen wird; Prüfen und Quittieren bleiben aktiv)
- [x] **Währung**: keine Annahme „CHF“ mehr
- [x] **Allgemeine Dokumente (Bord-ABC)**: die KI übernimmt nur Nummern und Hinweise des eigenen Schiffs als Zusatzinfos an Kreuzfahrt und Einschiffungstag
- [x] **Zeitleiste zeigt „Jetzt“** (Vergangenes ausgegraut, rosa Markierung mit Uhrzeit auf der Linie, aktualisiert sich jede Minute)
- [x] **Reisearten** (Kreuzfahrt, Städtetrip/Urlaub, Rundreise: Auswahl beim Anlegen oder automatisch nach den Dokumenten; Stationen mit Ort und von-bis, Prüfung auf fehlende Unterkunft, Verbindung und Überschneidung; Kreuzfahrt-Tab nur bei Kreuzfahrten)
- [x] **Reise prüfen** (Knopf „🔍 Prüfen“ in der Reise: KI-Durchsicht der ganzen Reise auf Lücken und Widersprüche, nur lesend, mit Sprung zu den betroffenen Einträgen)
- [x] **Web-Recherche** (optional im Prüfdialog: Reiseverlauf der Kreuzfahrt, Routen, Fahrzeiten, Check-in-Zeiten, Telefonnummern; optional mit Link zur Reise; Funde mit Quelle zuerst zur Auswahl, Anzeige, was gesucht wurde, nichts wird automatisch übernommen)
- [x] **Version der App in den Einstellungen anzeigen** (Versionsnummer und Stand, damit man nach einem Update sieht, was läuft)
- [x] **Kostenauswertung** (Reiter „Kosten“: Summen je Währung und Art, Währungen sauber getrennt, bezahlt und offen, fällige Restzahlungen, Beträge ohne Währung und gebuchte Leistungen ohne Preis; Preis und Zahlungsstand auch an der Kreuzfahrt)
- [ ] Packliste & Kostenübersicht pro Person
