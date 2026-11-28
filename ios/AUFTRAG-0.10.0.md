# AUFTRAG-0.10.0.md: Losgeh-Erinnerung, Live-Flugstatus, Check-in-Erinnerung, Sperrbildschirm (iOS-Auftrag 10)

Version **0.10.0, Build 10** (Regel 2: App, Widget, Teilen-Erweiterung gleich, 10 Vorkommen je Schlüssel). Philip hat bestellt: Check-in-Erinnerung,
Losgeh-Erinnerung, Live-Flugstatus und den Sperrbildschirm (Teil E). Server **0.15.0** bringt Check-in-Erinnerung und Live-Flugstatus, **0.16.0**
den Sperrbildschirm (`docs/API.md` Abschnitt „Sperrbildschirm“); vgl. `<repo>/docs/API.md`
Abschnitt „Terminal, Gate, Schalter, Kofferband, Gleis“ (Live-Flugstatus, Online-Check-in-Erinnerung). Vorbild für Anzeige und Einstellungen:
`<repo>/web/src/pages/Trip.tsx` (`liveLine`, `FlightLiveContext`), `pages/settings/Notifications.tsx`, `pages/settings/FlightStatus.tsx`.

**Keine Prüfung im Simulator** (Philips Entscheidung): nur Build und Unit-Tests, Philip prüft auf dem iPhone.

## Teil 0: Vorher
Trennungsprüfung, `git pull --rebase origin main`, `git config user.email` = noreply. Keine neue Capability (Standort „Beim Verwenden“ und
Background fetch gibt es seit 0.5.0; Live Activities brauchen keine Capability, nur den Info.plist-Schlüssel aus Teil E).

## Teil A: Live-Flugstatus anzeigen
- Beim Laden einer Reise mit Flügen zusätzlich `GET /trips/:id/flight-status` (auch im Offline-Cache ablegen, `flight-status-<id>.json`); solange
  die Reise offen ist, alle 2 min neu laden.
- Im Ablauf bei Flügen (nicht vergangen, Eintrag mit `checkedAt`) eine Zeile wie `liveLine` der Web-App: „Live: +45 min, Abflug 10:25 · Stand
  07:42“, „Live: planmäßig · Stand …“, „annulliert“, „umgeleitet“, „gestartet“, „gelandet 11:20“. Rot bei Annullierung oder ab 15 min Verspätung.
- Im Detail des Flugs ein Abschnitt „Live-Flugstatus“: Status, geplante und neue Abflug-/Ankunftszeit, Terminal, Schalter, Gate, Kofferband,
  Ankunftsterminal, Stand. Bei nur `error`: den Text grau. Ohne Daten und `enabled: false`: nichts zeigen.
- Widget: zeigt der nächste Termin einen Flug mit Verspätung, „+45 min“ dazuschreiben (aus dem Cache, kein eigener Abruf im Widget).
- Mitteilungen mit `tag` `live:<id>` und `info:<id>` öffnen wie bisher über `url` die Reise.

## Teil B: Einstellungen
- **Erinnerungen:** zwei neue Schalter wie Web: „Online-Check-in ist offen“ (`notifications.checkin`) und „Live-Flugstatus: Verspätung,
  Annullierung“ (`notifications.flightStatus`), mit den Erklärsätzen der Web-App.
- **Live-Flugstatus** (nur Admin, neuer Bereich wie `FlightStatus.tsx`): Stand aus `GET /flight-status/config` (eingerichtet, Schlüssel endet auf …,
  Abfragen diesen Monat von höchstens …), `SecureField` für den RapidAPI-Schlüssel, „Prüfen und speichern“ → `PUT /flight-status/config {key}`
  (400 = Grund zeigen), „Schlüssel entfernen“ (nur Quelle `settings`), Monatsgrenze → `{monthlyLimit}`. Schlüssel nie speichern (wie bei der KI).
- Im Flug-Formular (0.6.0) ein Feld **„Online-Check-in ab (Stunden vor Abflug)“** → `details.checkinHours` (leer = 24 h).

## Teil C: Losgeh-Erinnerung (nur App, Standort bleibt auf dem iPhone)
Ziel: „🚶 In 10 min los: Flughafen Zürich, 32 min mit dem Auto. LX 1726 um 09:40, am Flughafen sein bis 07:40.“
- Einstellung unter „Erinnerungen“: Schalter **„Losgeh-Erinnerung“** (Standard aus, in `UserDefaults`), Verkehrsmittel **Auto / ÖV / zu Fuß**
  (Standard Auto), Vorlauf der Mitteilung (5, 10, 15, 20 min vor dem Losgehen; Standard 10). Braucht Mitteilungen und Standort „Beim Verwenden“
  (wie „Erinnerungen am Ort“); bei Ablehnung Hinweis, Schalter bleibt aus.
- **Ziele** (reine Funktion `LosgehAuswahl`, testbar), aus laufenden/kommenden Reisen im Cache, Beginn in den nächsten **12 h**:
  | Anlass | Ort | „Dort sein“ |
  |---|---|---|
  | Flug | Abflughafen (`details.from`, Suche wie in 0.5.0) | Abflug minus 2 h (Kurz- und Mittelstrecke; Einstellung „Am Flughafen sein“ 1 h / 1,5 h / 2 h / 3 h, Standard 2 h) |
  | Zug | Abfahrtsbahnhof | Abfahrt minus 10 min |
  | Einschiffung | Hafen (wie 0.5.0) | `arrival` des Einschiffungstags (Beginn Check-in), sonst „Alle an Bord“ minus 60 min |
  | Ausflug, Aktivität | `details.meetingPoint`, sonst `location` | Beginn minus 15 min |
  | Mietwagen-Abholung | `location` | Beginn |
  Den **persönlichen Zeitbedarf** (aus `/me/settings` `pace`, wie Web `personalLead`) auf den Vorlauf „Dort sein“ anwenden (Faktor, Zusatzminuten,
  aufrunden auf 5 min). Zeiten sind Ortszeit + Zeitzone (`NowLogic`).
- **Fahrzeit:** `MKDirections` (`calculateETA`, Verkehrsmittel aus der Einstellung; bei ÖV ohne Ergebnis auf Auto zurückfallen und das im Text sagen)
  vom aktuellen Standort zum Ort. Losgehen = „Dort sein“ minus Fahrzeit; Mitteilung = Losgehen minus Vorlauf. Liegt der Standort näher als
  1 km am Ziel oder ist die Mitteilungszeit vorbei: keine Mitteilung.
- **Planen:** lokale Mitteilung mit Zeit-Trigger, Kennung `los-<eintrag-id>` bzw. `los-day-<tag-id>`, `url` wie bisher. Neu berechnen (alle `los-*`
  ersetzen) beim Start, beim Wechsel in den Vordergrund, nach jedem Laden und in der `BGAppRefreshTask` aus 0.5.0 (dort mit dem letzten bekannten
  Standort, `CLLocationManager.location`). Ohne Standort: keine Mitteilung, in „Geplant“ als „Standort unbekannt“ zeigen.
- Unter dem Schalter eine Liste **„Geplant“** wie bei 0.5.0: Ziel, Fahrzeit, „los um 07:05“, Mitteilung um 06:55.
- Satz darunter: „Die Fahrzeit wird beim Öffnen der App und bei Hintergrundaktualisierungen neu berechnet. Verkehr nach dem letzten Öffnen
  kennt die Erinnerung nicht.“
- Abmelden und Ausschalten entfernen alle `los-*`.

## Teil E: Sperrbildschirm (Live Activity, Dynamic Island)
Vertrag: `<repo>/docs/API.md` Abschnitt „Sperrbildschirm“. **Den Inhalt berechnet der Server**; die App zeigt ihn nur an.
- `Info.plist` der App: `NSSupportsLiveActivities` = YES (und `NSSupportsLiveActivitiesFrequentUpdates` = YES).
- Gemeinsamer Typ **`ReisebuchActivityAttributes: ActivityAttributes`** (Datei in App und Widget, Ausnahme im synchronisierten Ordner wie
  `WidgetStand.swift`). **Der Typname muss genau so heißen** (Push-to-start nennt ihn). Felder `tripId`, `tripTitle`; `ContentState` mit genau den
  Feldern von `LockState` (`icon`, `title`, `time`, `targetLabel`, `target` als Unix-Sekunden `Int`, `place`, `live`, `alert`, `next`), Namen nicht
  ändern.
- Im Widget-Target ein `ActivityConfiguration` (im bestehenden `WidgetBundle`):
  - **Sperrbildschirm:** links groß Symbol und Titel, darunter `place` fett; rechts `targetLabel` und Countdown bis `target`
    (`Text(timerInterval:countsDown:)`, kein eigenes Neuladen); Zeile `live` (rot, wenn `alert`); unten klein `next`. Reisename `tripTitle` klein oben.
  - **Dynamic Island:** kompakt links Symbol, rechts Countdown; minimal Symbol; erweitert wie Sperrbildschirm in kurz.
  - Antippen öffnet `reisebuch://trip/<tripId>` (gleicher Weg wie Widget und Push).
  - Ist der Inhalt veraltet (`context.isStale`), den Countdown grau und „Stand unklar“ zeigen.
- **Push-to-start (iOS 17.2+):** beim Start der App, wenn angemeldet und Push an: `Activity<ReisebuchActivityAttributes>.pushToStartTokenUpdates`
  beobachten und jedes Token mit `POST /live-activity/tokens {token, kind: "start", replaces: <voriges>}` melden (Hex, klein). Für jede Aktivität
  (auch vom Server gestartete, `Activity.activityUpdates`) `pushTokenUpdates` beobachten und mit `kind: "update", tripId` melden.
- **Lokal starten:** In der Reise ein Knopf **„Auf den Sperrbildschirm“** (nur wenn `GET /trips/:id/live-activity` einen `state` liefert): startet die
  Aktivität mit `pushType: .token` und diesem Inhalt; „Vom Sperrbildschirm nehmen“ beendet sie (und `DELETE /live-activity/tokens`).
  Höchstens eine Reisebuch-Aktivität gleichzeitig.
- **Einstellungen → Erinnerungen:** Schalter „Sperrbildschirm am Reisetag“ (`notifications.lockScreen`, Text wie Web). Ist Live Activities in den
  iOS-Einstellungen aus (`ActivityAuthorizationInfo().areActivitiesEnabled`), Hinweis mit „In iOS-Einstellungen öffnen“.
- **Abmelden:** alle eigenen Tokens mit `DELETE` abmelden, laufende Aktivitäten beenden.

## Teil D: Prüfen
- Build grün für alle Targets, keine Warnungen (auch Archiv-Log).
- Unit-Tests: `liveLine`-Texte (alle Zustände, rot ab 15 min), Lesen von `/trips/:id/flight-status` mit fehlenden Feldern und nur `error`;
  `LosgehAuswahl` (Ziele je Art, 12-h-Fenster, „Dort sein“ je Art inkl. Zeitbedarf und Einstellung „Am Flughafen sein“, Zeitzonen),
  Losgeh-Rechnung (Fahrzeit, Vorlauf, „näher als 1 km“, „schon vorbei“), Kennungen stabil; Dekodieren von `LockState` aus einem
Push-Beispiel (alle Felder, `null`-Felder) und aus `GET /trips/:id/live-activity`, Token als Hex; `checkinHours` im Flug-Formular (leer entfernt den
  Schlüssel, andere `details` bleiben); PUT-Bodies für `/flight-status/config`. Gegenprobe.
- **IPA ist freigegeben** nach `ios/Installation/0.10.0-b10/`, letzte drei behalten, Profile wie bisher.
- `STAND.md` mit „Was Philip testen soll“ (Live-Zeile bei einem Flug in den nächsten 24 h, sobald der Admin den Schlüssel eingetragen hat;
  Check-in-Schalter; Losgeh-Erinnerung mit einem Testeintrag „Aktivität“ in 2 h an einem Ort 10 km entfernt; Sperrbildschirm: Testeintrag „Flug“ in 2 h mit Gate,
„Auf den Sperrbildschirm“, Gate ändern → Anzeige folgt innerhalb von 1 min; ohne Knopf: startet der Server sie 3 h vorher von selbst), „Neu in 0.10.0“ in `ios/CLAUDE.md`,
  Auftrag nach `ios/Auftraege/`, committen, pull, push.
