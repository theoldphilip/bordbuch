# AUFTRAG-0.1.0.md: Neues Projekt anlegen, Anmeldung, Reisen und Ablauf lesen (iOS-Auftrag 1)

Version **0.1.0, Build 1**. Erste Version der iPhone-App von Reisebuch. Nur iPhone, keine Watch, kein Widget.

## Ziel

Ein eigenes, neues Xcode-Projekt `Reisebuch` im Repository `bordbuch`, das sich am Server anmeldet, die Reisen zeigt und den Ablauf einer
Reise **lesend** darstellt, so wie die Web-App unterwegs: wann, wo, Gate/Schalter/Gleis, Hinweise des Puffer-Checks, Telefonnummern zum
Antippen. Nichts bearbeiten, keine KI, kein Push, noch nicht offline.

---

## Teil 0: Trennung vom Gym-Projekt (zwingend, vor allem anderen)

Auf diesem Mac liegt auch das Projekt „Philip's Gym“ (`gym-native`). **Es darf nichts davon gelesen, verändert, gebaut oder committet
werden.** Diese App ist ein **neues, eigenes** Projekt in einem **anderen** Repository.

### 0.1 Was Philip vorher tut (im Terminal, nicht du)
1. Einen **neuen Ordner außerhalb** des Gym-Ordners wählen, zum Beispiel `~/Projekte/bordbuch`. Er darf nicht im Gym-Ordner liegen und
   den Gym-Ordner nicht enthalten.
2. `git clone https://github.com/theoldphilip/bordbuch.git ~/Projekte/bordbuch`
3. Claude Code **neu** starten, und zwar in `~/Projekte/bordbuch/ios` (nicht im Gym-Ordner, keine laufende Gym-Sitzung weiterverwenden).

### 0.2 Was du als Erstes prüfst
Führe die **Trennungsprüfung** aus `ios/CLAUDE.md` aus und schreib die Ausgabe gekürzt in `ios/STAND.md`. Zusätzlich:

- `git log --oneline -3` muss Commits von Reisebuch zeigen (Server, Web, Kosten, Reisetag-Abfrage), keine Gym-Commits.
- `git ls-files | grep -ci gym` muss `0` sein.
- `ls ..` (Repo-Wurzel) zeigt `server`, `web`, `docs`, `ios`, `CLAUDE.md`, `VERSION`.

Stimmt etwas nicht: **aufhören**, nichts anlegen, in `ios/STAND.md` melden, `STAND.md` allein committen und pushen, Philip fragen.

### 0.3 Projekt anlegen (Philip in Xcode, du gibst ihm die Anleitung und prüfst danach)
Das Projekt legt **Philip** in Xcode an (Signing ist seine Sache). Gib ihm im Terminal diese Schritte und warte auf sein „fertig“:

1. Xcode → *File → New → Project… → iOS → App*.
2. Product Name **`Reisebuch`**, Team: sein Team, Organization Identifier **`de.theoldphilip`** (ergibt die Bundle-ID
   **`de.theoldphilip.Reisebuch`**), Interface **SwiftUI**, Language **Swift**, Storage **None**, Testing System nach Wahl (Swift Testing ist
   recht), **keine** Host-in-CloudKit-Option.
3. Speicherort: **`~/Projekte/bordbuch/ios`** (der Ordner, in dem `CLAUDE.md` und dieser Auftrag liegen).
   **„Create Git repository on my Mac“ AUS** (das Repository gibt es schon). Ergebnis: `ios/Reisebuch.xcodeproj` und `ios/Reisebuch/`.
4. **Keine** Capabilities hinzufügen (keine App Group, kein Push, kein HealthKit). Nichts aus dem Gym-Projekt kopieren.

Danach prüfst du und schreibst es in `STAND.md`:
- `ios/Reisebuch.xcodeproj` existiert; es gibt kein zweites `.xcodeproj` unter `ios/`.
- `grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' ios/Reisebuch.xcodeproj/project.pbxproj | sort -u`: nur `de.theoldphilip.Reisebuch`
  (und ggf. `…ReisebuchTests`/`…ReisebuchUITests`).
- `grep -ric gymnative ios/` ergibt 0 Treffer außer in `CLAUDE.md` und diesem Auftrag (dort steht das Wort als Warnung).
- Keine `.entitlements`-Datei unter `ios/`.
- `git status` zeigt neue Dateien **nur unter `ios/`**. `xcuserdata/` und `*.xcuserstate` kommen in eine neue `ios/.gitignore`
  (dazu `shots/`, `DerivedData/`, `*.xcarchive`, `.DS_Store`).

Erster Commit: das leere Projekt mit grünem Build, `iOS 0.1.0: leeres Projekt Reisebuch angelegt`.

---

## Teil A: Grundlagen

- Version **0.1.0**, Build **1** in allen Vorkommen (Regel 2).
- App-Symbol: `ios/Design/AppIcon-1024.png` (1024 × 1024, ohne Transparenz) in den Asset-Katalog `AppIcon` übernehmen (eine Größe genügt).
  Anzeigename „Reisebuch“.
- Nur Hochformat ist nicht nötig; die App soll im Hoch- und Querformat bedienbar sein. Dunkel- und Hellmodus wie das System.
- Keine fremden Pakete. Nur Foundation, SwiftUI, Security (Schlüsselbund).
- **Netzwerk ohne HTTPS:** Der Server ist im Heimnetz unter `http://172.16.10.1:8080` erreichbar. Prüfe, ob iOS das ohne Ausnahme erlaubt
  (App Transport Security gilt für IP-Adressen möglicherweise nicht). Wenn nicht: in der `Info.plist` **nur**
  `NSAppTransportSecurity → NSAllowsLocalNetworking = YES`. **Nicht** `NSAllowsArbitraryLoads`. Reicht das nicht, aufhören und fragen.

## Teil B: Anmeldung

- Bildschirm „Anmelden“: Server-Adresse (Vorgabe `http://172.16.10.1:8080`), Benutzername, Passwort (`SecureField`), Knopf „Anmelden“.
- `POST <adresse>/api/auth/login` mit `{username, password, deviceName: "iPhone-App"}` → `{user: {id, username, displayName, isAdmin}, token}`.
- Token im **Schlüsselbund** (`kSecClassGenericPassword`, Service `de.theoldphilip.Reisebuch`, Account `token`), Adresse und Anzeigename in
  `UserDefaults`. Kein Passwort speichern.
- Fehlermeldungen in Deutsch und verständlich: Server nicht erreichbar („Ist das VPN an?“), 401 → „Benutzername oder Passwort falsch“,
  sonst der Text aus `{"error": "…"}` der Antwort.
- „Abmelden“ (in einer kleinen Einstellungsseite oder im Menü der Reiseliste): `POST /api/auth/logout`, dann Token löschen, zurück zur
  Anmeldung. Scheitert der Aufruf (offline), trotzdem lokal abmelden.
- Antwortet der Server bei irgendeiner Anfrage mit **401**, ist das Token ungültig: lokal abmelden und die Anmeldung zeigen.
- Einstellungsseite zeigt: angemeldet als (Anzeigename), Server-Adresse, App-Version und Build (aus dem Bundle), Server-Version aus
  `GET /api/version` (`{version, builtAt, schema}`, öffentlich).

## Teil C: Reiseliste

- `GET /api/trips` → Liste mit `id`, `title`, `kind` (`cruise`, `city`, `roundtrip`), `effectiveStartDate`, `effectiveEndDate`, `role`,
  `ships[]`, `memberCount`, `updatedAt` (siehe `docs/API.md` „Reisen“ und `web/src/types.ts` `TripSummary`).
- Anzeige: Titel, Zeitraum („8. Mai – 13. Mai 2027“, deutsch formatiert), Reiseart als Symbol (Kreuzfahrt 🛳️, Städtetrip 🏙️, Rundreise 🗺️),
  bei Kreuzfahrten die Schiffe. Laufende und kommende Reisen oben, vergangene darunter unter „Vergangen“.
- Ziehen zum Aktualisieren. Leere Liste: ruhiger Hinweis „Noch keine Reisen. Reisen legst du in der Web-App an.“

## Teil D: Ablauf einer Reise (nur lesen)

- `GET /api/trips/:id/timeline` (Aufbau in `docs/API.md` „Timeline“, Typen in `web/src/types.ts` `Timeline`, `TimelinePhase`,
  `TimelineDay`, `TimelineEntry`, `TimelineWarning`).
- **Gliederung:** Abschnitte (`phases[].title`, z. B. „Anreise“, „Kreuzfahrt · MS Aurora“, „Abreise“), darin Tage (Datum als Überschrift,
  z. B. „Fr., 8. Mai“), darin die Einträge in Reihenfolge.
- **Eintrag:** Uhrzeit (`time`, leer bei ganztägigen), Symbol je `item.type` (wie die Web-App, `web/src/format.ts` `ITEM_TYPES`),
  `item.title`. Bei `role: "end"` die Ende-Bezeichnung (Check-out, Rückgabe, Ausfahrt, Ankunft; `endLabel` in `format.ts`).
- **Wo ihr sein müsst, fett unter dem Titel:** aus `item.details` Terminal, Schalter (`checkinDesk`), Gate, Kofferband (`baggageBelt`) beim
  Flug, Gleis (`platform`) beim Zug, Schalter (`desk`) beim Mietwagen, z. B. „Terminal 1 · Schalter 31–40 · Gate B12“ (wie `placeLine` in
  `format.ts`). Nur was gesetzt ist.
- **Kreuzfahrt-Tag** (`cruiseDay` am Tag): Art (Einschiffung, Hafentag, Seetag, Ausschiffung), Hafen, Ankunft/Abfahrt, „Alle an Bord“ deutlich
  hervorgehoben, Hinweis „Tenderhafen“ bei `tender`.
- **Hinweise des Puffer-Checks** (`warnings`): oben als aufklappbarer Kasten mit Anzahl; Farben nach `level` (`error` rot, `warning`
  orange/gelb, `info` blau/grau). Quittierte Hinweise (`ack` nicht `null`) nicht mitzählen, aber unter „Quittiert“ aufklappbar zeigen.
  Hinweise mit `itemId` zusätzlich klein am Eintrag. `personal: true` als kleines Etikett „nur persönlich“.
- **Eintrag antippen → Detailansicht (nur lesen):** alle vorhandenen Felder (Zeiten mit Zeitzone, Ort, Anbieter, Buchungsnummer, Kosten mit
  Währung, Notizen, Details), dazu die **Zusatzinfos** (`item.infos`): `phone` und `emergency` als Anruf-Link (`tel:` ohne Leerzeichen),
  `email` als `mailto:`, `link` als Link, `text` als Text. Infos mit `source` `ai` oder `web` tragen den Hinweis „bitte prüfen“.
  Ein Hafentag lässt sich ebenso antippen (seine `infos` liegen an `cruiseDay.infos`).
- Ziehen zum Aktualisieren. Kein Bearbeiten, kein Quittieren, keine Reisetag-Abfrage in dieser Version.

## Teil E: Prüfen

- Build grün, keine Warnungen (jede Warnung melden).
- **Mit Daten prüfen**, eins von beiden:
  1. Testserver des Repos (bevorzugt, keine echten Daten): Ist Node ≥ 22.18 vorhanden (`node --version`), in der Repo-Wurzel
     `npm run install:all`, `npm run build` (Web), dann `node --experimental-strip-types scripts/dev/fake-server.ts` (Port 8091). Konto und
     eine Beispielreise mit Kreuzfahrt, Flug mit Gate, Hotel, Ausflug und Zusatzinfos **über die API** anlegen (Vorbild:
     `scripts/dev/browser-check.cjs`). Im Simulator gegen `http://localhost:8091` anmelden. `node_modules/` ist in `.gitignore`; im Repo
     darf sich außer unter `ios/` nichts ändern (`git status` vor dem Commit).
  2. Ist Node nicht da: **nicht installieren.** Dann Philip bitten, sich im Simulator gegen den echten Server anzumelden (er tippt selbst);
     du liest die Zugangsdaten nicht und schreibst sie nirgends hin.
- Bildschirmfotos: Anmeldung, Reiseliste, Ablauf mit Hinweis-Kasten, Flug mit Gate, Hafentag, Detail mit Telefonnummer. Nicht ins Repo;
  in `STAND.md` beschreiben, was zu sehen ist.
- **Nicht auf Philips iPhone installieren**, keine IPA. Das kommt mit einer eigenen Freigabe.

## Rückgabe

`ios/STAND.md` nach der Vorlage in `ios/CLAUDE.md`, mit der Ausgabe der Trennungsprüfung. Danach diesen Auftrag mit `git mv` nach
`ios/Auftraege/AUFTRAG-0.1.0.md` verschieben, committen, `git pull --rebase origin main`, pushen. In „Stand der App“ von `ios/CLAUDE.md` einen
kurzen Block „Neu in 0.1.0“ ergänzen.

Offene Fragen gehören in `STAND.md`, nicht geraten. Der Architekt antwortet mit einem Nachtrag in diesem Auftrag.
