# Ideen für Reisebuch (Stand 28.11.2026)

Sammlung nach Server 0.14.0 und iPhone-App 0.9.0. Nichts davon ist bestellt. Aufwand grob: S = Stunden, M = etwa ein Tag, L = mehrere Tage.
„Server“ baut der Architekt, „App“ ist ein Auftrag an den Mac.

## Meine Empfehlung für die nächsten Schritte

1. **Online-Check-in-Erinnerung** (S, Server): Push zum Öffnen des Check-ins (meist 24 bis 48 h vor Abflug), mit Link zur Airline.
2. **Losgeh-Erinnerung mit Fahrzeit** (M, App): „Du musst in 20 min los“, berechnet aus deinem Standort und dem nächsten Termin.
3. **Kalender-Abo** (S, Server): Reisen erscheinen im iPhone-Kalender der ganzen Familie.
4. **Packliste mit Vorlagen** (M, Server + App + Web): lange gewünscht, jetzt mit Bearbeiten in der App gut machbar.
5. **KI-Kosten im Blick** (S, Server): Mit drei Anbietern sollte sichtbar sein, was die KI pro Monat kostet.

## Am Reisetag und unterwegs

- **Online-Check-in-Erinnerung** (S): Push „Check-in für LX 1726 ist offen“ mit Link. Zeitpunkt je Airline unterschiedlich, Standard 24 h, im
  Eintrag änderbar.
- **Losgeh-Erinnerung** (M, App): MapKit rechnet die Fahrzeit vom aktuellen Ort zum nächsten Termin (Auto, ÖV, zu Fuß) und meldet, wann
  du losmusst, inklusive persönlichem Zeitbedarf. Läuft nur auf dem iPhone, der Standort bleibt dort.
- **„Zurück zum Schiff“** (M, App): An Hafentagen mit „Alle an Bord“ vergleicht die App Entfernung und Fahrzeit zum Hafen mit der
  verbleibenden Zeit und warnt früh genug. Für Kreuzfahrten vermutlich die nützlichste Funktion überhaupt.
- **Live Activity / Dynamic Island** (M, App + Server): Am Reisetag der nächste Schritt mit Countdown auf dem Sperrbildschirm („Boarding
  B12 in 0:45“). Aktualisierung per APNs, wenn sich Gate oder Zeit ändern.
- **Live-Flugstatus** (M, Server): Verspätung, Gate, Gepäckband von einem Flugdaten-Dienst (z. B. AeroDataBox, kostenloses Kontingent, Schlüssel
  nötig) statt KI-Suche. Bei Änderung Push an alle Mitglieder (die Logik dafür gibt es schon).
- **Navigieren** (S, App): Bei jedem Ort ein Knopf „In Karten öffnen“ (Apple Maps, Google Maps).
- **Wallet** (S, App): Erkennt eine Bordkarte (`.pkpass`) in den Dokumenten und bietet „Zu Wallet hinzufügen“.
- **Wetter je Ort und Tag** (S bis M, Server): Vorhersage ab 10 Tagen vorher (Open-Meteo, ohne Schlüssel), im Ablauf beim Tag.
- **Siri und Kurzbefehle** (M, App): „Wann muss ich am Schiff sein?“, „Was ist mein Gate?“, „Nächster Termin“.

## Planen und Vorbereiten

- **Packliste** (M): Reiter je Reise mit Checkliste für alle Mitglieder. Vorlagen je Reiseart (Kreuzfahrt mit Abendgarderobe,
  Städtetrip …), auf Wunsch KI-Vorschlag nach Ziel, Dauer und Wetter. Haken in der App, auch offline (wird später abgeglichen).
- **Einreise-Checkliste** (M): Die KI listet für Ziel und Staatsangehörigkeit nötige Dokumente (Pass, ESTA, eTA, Visum, Impfungen) mit
  Quelle, als „bitte prüfen“. Dazu Ablaufdaten von Pässen je Person mit Erinnerung, wenn er für eine Reise zu knapp gültig ist.
- **Kosten pro Person** (M): Ausgaben auf Mitreisende aufteilen, wer hat was bezahlt, wer schuldet wem. Optional Umrechnung in eine
  Heimatwährung mit Tageskursen der EZB (kostenlos), immer als „ca.“ gekennzeichnet.
- **Nächtliche Reise-Prüfung** (S, Server): 7 Tage und 1 Tag vor Abreise prüft die KI die Reise automatisch und schickt nur bei neuen
  Problemen eine Mitteilung.
- **Reise kopieren** (S): Eine Reise als Vorlage für die nächste (gleiche Anreise, gleicher Parkplatz).

## Dokumente und Eingang

- **Mail-Eingang** (M bis L, Server): Buchungsmails an ein eigenes Postfach weiterleiten; der Server holt sie per IMAP, ordnet sie der passenden
  Reise zu und schickt „📄 Neue Buchung gelesen“. Erspart das Hochladen ganz. Braucht ein eigenes Postfach und dessen Zugangsdaten auf der Syno.
- **Dokument an mehrere Einträge** (S): z. B. eine Buchung für Hin- und Rückflug (offener Wunsch).
- **„Automatisch übernehmen, wenn sicher“** (S): Vorschläge mit hoher Sicherheit und ohne Probleme ohne Prüfbildschirm übernehmen, mit
  Rückgängig (offener Wunsch).

## Familie und Teilen

- **Kalender-Abo** (S, Server): Je Person eine geheime ICS-Adresse; iPhone-Kalender zeigt alle Termine der Reisen (nur im Heimnetz/VPN
  erreichbar, aktualisiert sich selbst).
- **Einladung für die iPhone-App** (S): Der Einladungstext erklärt heute nur die Web-App; eine Variante für Familienmitglieder mit der App.
- **Reisetagebuch** (M): Pro Tag Notiz und Fotos, am Ende ein PDF-Reisebericht zum Teilen (Generator gibt es schon).

## Betrieb und Sicherheit

- **KI-Kosten** (S): Tokens und geschätzte Kosten je Anbieter und Monat in „KI und Dokumente“, Warnung ab einem eigenen Limit.
- **Update-Skript** (S, Philip): Korrigierte Zeile, damit ein gescheitertes `git pull` nicht mehr „App antwortet nicht“ meldet (liegt bereit).
- **Doku-PDF** (S): „Bedienung und Betrieb“ auf den Stand mit iPhone-App, Push, Teilen, KI-Anbietern bringen.
- **Externe Sicherung** (S): Tägliche Kopie der Datenbank zusätzlich auf ein anderes Ziel (Hyper Backup oder USB), Prüfung im Status.
- **Export** (S): Eine Reise als JSON und PDF herunterladen, z. B. als Notfallkopie offline auf dem iPhone.
- **Notfall-Seite** (S, App): Offline eine Seite mit Notrufnummern, Versicherung, Kartensperre, Botschaft je Reiseland. Keine Ausweiskopien
  ohne ausdrücklichen Wunsch (sensibel).

## Bewusst nicht vorgeschlagen

- Öffentlicher Link ohne Konto: Reisebuch ist absichtlich nur über VPN erreichbar; das würde es ins Internet stellen.
- Apple Watch: von Philip vorerst ausgeschlossen. Wäre nach Live Activity aber nur ein kleiner Schritt.
