//
//  PlaceReminders.swift
//  Reisebuch
//
//  Erinnerungen am Ort (Auftrag 0.5.0): Kommt Philip am Reisetag am Flughafen, Bahnhof, Hafen, an der Mietwagen-Station oder am
//  Hotel an, zeigt iOS eine lokale Mitteilung mit Gate, Gleis, Zeiten. Lokale Mitteilungen mit UNLocationNotificationTrigger
//  (Erlaubnis „Beim Verwenden der App“ genügt). Der Standort verlässt das iPhone nie; der Server erfährt nichts davon.
//
//  Drei getrennte Teile: OrtAuswahl (reine Funktion, getestet), OrtSuche (MapKit auf dem Gerät, Ergebnisse zwischengespeichert),
//  PlaceReminderController (Erlaubnis, Planen, Anzeige in den Einstellungen).
//

import CoreLocation
import Foundation
import MapKit
import Observation
import UserNotifications

// MARK: - Auswahl (rein)

/// Wonach gesucht wird: Flughafen und Bahnhof mit Filter, sonst freie Suche bzw. Adresse.
struct OrtSuchtext: Hashable, Codable {
    enum Art: String, Codable { case flughafen, bahnhof, ort, adresse }
    let art: Art
    let text: String
}

/// Ein möglicher Ort für eine Erinnerung.
struct OrtKandidat: Equatable, Identifiable {
    /// `ort-<eintrag-id>` bzw. `ort-day-<tag-id>`; zugleich Kennung der Mitteilung.
    let id: String
    let tripId: String
    /// Überschrift der Mitteilung, z. B. „✈️ Zürich → Rom“.
    let titel: String
    /// Text der Mitteilung, z. B. „Abflug 09:40 · Terminal 2 · Gate B12“.
    let text: String
    /// Suchtexte in dieser Reihenfolge; der erste Treffer gilt. Leer: kein Ort eingetragen.
    let suche: [OrtSuchtext]
    let radius: Double
    /// Zeitpunkt des Anlasses (Abflug, Abfahrt, Alle an Bord, Abholung, Check-in), zum Sortieren und Anzeigen.
    let zeit: Date
    /// Zeitzone des Anlasses (für die Anzeige der Uhrzeit).
    let tz: String
    /// Fenster, in dem die Erinnerung sinnvoll ist. Geplant wird, wenn `ab` in den nächsten 36 h liegt und `bis` noch nicht vorbei ist.
    let ab: Date
    let bis: Date
}

enum OrtAuswahl {
    static let horizont: TimeInterval = 36 * 3600
    static let maxGeplant = 20
    static let prefix = "ort-"

    /// Alle Kandidaten der nächsten 36 h aus laufenden und kommenden Reisen, nach Zeitpunkt sortiert.
    static func kandidaten(_ trips: [(trip: TripSummary, timeline: Timeline, detail: TripDetail?)], now: Date) -> [OrtKandidat] {
        var result: [OrtKandidat] = []
        var seen = Set<String>()
        let grenze = now.addingTimeInterval(horizont)
        for (trip, timeline, detail) in trips {
            let defaultTz = timeline.defaultTimezone ?? "Europe/Zurich"
            for phase in timeline.phases {
                for day in phase.days {
                    if let cd = day.cruiseDay, cd.kind == "embarkation",
                       let k = einschiffung(cd, phase: phase, trip: trip, detail: detail, defaultTz: defaultTz) {
                        if seen.insert(k.id).inserted { result.append(k) }
                    }
                    for e in day.entries where e.role != "end" {
                        guard let k = eintrag(e, trip: trip, defaultTz: defaultTz) else { continue }
                        if seen.insert(k.id).inserted { result.append(k) }
                    }
                }
            }
        }
        return result
            .filter { $0.bis > now && $0.ab <= grenze }
            .sorted { $0.zeit != $1.zeit ? $0.zeit < $1.zeit : $0.id < $1.id }
    }

    /// Was geplant wird: die frühesten gefundenen Orte, höchstens 20 (Grenze von iOS).
    static func zumPlanen(_ kandidaten: [OrtKandidat], gefunden: Set<String>) -> [OrtKandidat] {
        Array(kandidaten.filter { gefunden.contains($0.id) }.prefix(maxGeplant))
    }

    // MARK: Einträge

    static func eintrag(_ e: TimelineEntry, trip: TripSummary, defaultTz: String) -> OrtKandidat? {
        let item = e.item
        let tz = e.timezone ?? item.startTz ?? defaultTz
        guard let start = NowLogic.instant(item.startLocal, tz: tz, dateOnlyAsEnd: false),
              let startEnde = NowLogic.instant(item.startLocal, tz: tz, dateOnlyAsEnd: true) else { return nil }
        let d = item.detailMap
        let uhr = uhrzeit(item.startLocal)
        let location = clean(item.location)
        let symbol = Labels.itemType(item.type).icon

        let text: [String?]
        var suche: [OrtSuchtext] = []
        let radius: Double
        var ab = start
        var bis = startEnde
        switch item.type {
        case "flight":
            if let from = clean(d["from"]) {
                let iata = from.count == 3 && from.allSatisfy { $0.isLetter && $0.isASCII }
                suche.append(OrtSuchtext(art: .flughafen, text: iata ? "\(from.uppercased()) Airport" : from))
            }
            if let location { suche.append(OrtSuchtext(art: .ort, text: location)) }
            radius = 2000
            text = [mit("Abflug", uhr), feld("Terminal", d["terminal"]), feld("Schalter", d["checkinDesk"]), feld("Gate", d["gate"])]
        case "train":
            if let from = clean(d["from"]) { suche.append(OrtSuchtext(art: .bahnhof, text: from)) }
            if let location { suche.append(OrtSuchtext(art: .ort, text: location)) }
            radius = 400
            text = [mit("Abfahrt", uhr), feld("Gleis", d["platform"]), feld("Wagen/Platz", d["seat"])]
        case "car_rental":
            if let location {
                suche.append(OrtSuchtext(art: .adresse, text: location))
                suche.append(OrtSuchtext(art: .ort, text: location))
            }
            radius = 300
            text = [mit("Abholung", uhr), feld("Schalter", d["desk"]), clean(item.provider), feld("Buchung", item.confirmation)]
        case "hotel":
            if let location {
                suche.append(OrtSuchtext(art: .adresse, text: location))
                suche.append(OrtSuchtext(art: .ort, text: "\(item.title), \(location)"))
            }
            radius = 200
            ab = start.addingTimeInterval(-6 * 3600)
            bis = start.addingTimeInterval(12 * 3600)
            text = [uhr.map { "Check-in ab \($0)" } ?? "Check-in", feld("Zimmer", d["room"]), feld("Buchung", item.confirmation)]
        default:
            return nil
        }
        return OrtKandidat(id: "\(prefix)\(item.id)", tripId: trip.id, titel: "\(symbol) \(item.title)",
                           text: text.compactMap { $0 }.joined(separator: " · "), suche: suche, radius: radius,
                           zeit: start, tz: tz, ab: ab, bis: bis)
    }

    // MARK: Einschiffung

    static func einschiffung(_ cd: CruiseDay, phase: TimelinePhase, trip: TripSummary, detail: TripDetail?,
                             defaultTz: String) -> OrtKandidat? {
        let tz = cd.timezone ?? defaultTz
        guard let tagBeginn = NowLogic.instant(cd.date, tz: tz, dateOnlyAsEnd: false),
              let tagEnde = NowLogic.instant(cd.date, tz: tz, dateOnlyAsEnd: true) else { return nil }
        let allAboard = clean(cd.allAboard)
        let bisZeit = allAboard ?? clean(cd.departure)
        let bis = bisZeit.flatMap { NowLogic.instant("\(cd.date)T\($0)", tz: tz) } ?? tagEnde

        let cruise = detail?.cruises?.first { $0.id == (phase.cruiseId ?? cd.cruiseId) } ?? detail?.cruises?.first
        let schiff = clean(cruise?.shipName) ?? schiffAusTitel(phase.title) ?? trip.ships?.first ?? "Kreuzfahrt"

        var suche: [OrtSuchtext] = []
        if let port = clean(cd.portName) {
            let land = clean(cd.country).map { ", \($0)" } ?? ""
            suche.append(OrtSuchtext(art: .ort, text: "Cruise Terminal \(port)\(land)"))
            suche.append(OrtSuchtext(art: .ort, text: "Hafen \(port)\(land)"))
        }
        let text = ["Einschiffung", feld("Kabine", cruise?.cabin), allAboard.map { "Alle an Bord \($0)" }]
        return OrtKandidat(id: "\(prefix)day-\(cd.id)", tripId: trip.id, titel: "🚢 \(schiff)",
                           text: text.compactMap { $0 }.joined(separator: " · "), suche: suche, radius: 1500,
                           zeit: bis, tz: tz, ab: tagBeginn, bis: bis)
    }

    /// „Kreuzfahrt · MS Aurora“ → „MS Aurora“.
    static func schiffAusTitel(_ title: String) -> String? {
        guard let range = title.range(of: " · ") else { return nil }
        return clean(String(title[range.upperBound...]))
    }

    // MARK: Hilfen

    /// „2027-05-08T09:40“ → „09:40“; nur Datum → nil.
    static func uhrzeit(_ local: String) -> String? {
        let parts = local.split(separator: "T", maxSplits: 1)
        guard parts.count == 2 else { return nil }
        let t = String(parts[1].prefix(5))
        return t.count == 5 ? t : nil
    }

    private static func mit(_ label: String, _ uhr: String?) -> String {
        uhr.map { "\(label) \($0)" } ?? label
    }

    private static func feld(_ label: String, _ value: String?) -> String? {
        clean(value).map { "\(label) \($0)" }
    }

    private static func clean(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }
}

// MARK: - Ortssuche (MapKit, auf dem Gerät)

/// Ergebnis einer Suche; `nil`-Koordinaten = nicht gefunden.
struct OrtTreffer: Codable {
    let lat: Double?
    let lon: Double?
    let name: String?
    let at: Date

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

/// Sucht Orte mit MapKit und merkt sich die Ergebnisse je Suchtext in `cache/places.json` (Abmelden löscht den Ordner).
/// „Nicht gefunden“ wird 12 Stunden gemerkt, damit nicht bei jedem Planen erneut gesucht wird.
enum OrtSuche {
    static let file = "places.json"
    static let nichtGefundenGueltig: TimeInterval = 12 * 3600

    private static func key(_ s: OrtSuchtext) -> String { "\(s.art.rawValue):\(s.text.lowercased())" }

    static func loadCache() -> [String: OrtTreffer] {
        guard let entry = ResponseCache.load(file) else { return [:] }
        return (try? JSONDecoder().decode([String: OrtTreffer].self, from: entry.data)) ?? [:]
    }

    static func saveCache(_ cache: [String: OrtTreffer]) {
        if let data = try? JSONEncoder().encode(cache) { ResponseCache.save(data, as: file) }
    }

    /// Erster Treffer der Suchtexte in Reihenfolge, sonst nil.
    static func finde(_ suche: [OrtSuchtext], cache: inout [String: OrtTreffer], now: Date = Date()) async -> OrtTreffer? {
        for s in suche {
            let k = key(s)
            if let hit = cache[k] {
                if hit.coordinate != nil { return hit }
                if now.timeIntervalSince(hit.at) < nichtGefundenGueltig { continue }
            }
            guard let item = await search(s) else {
                cache[k] = OrtTreffer(lat: nil, lon: nil, name: nil, at: now)
                continue
            }
            let c = item.location.coordinate
            let hit = OrtTreffer(lat: c.latitude, lon: c.longitude, name: item.name, at: now)
            cache[k] = hit
            return hit
        }
        return nil
    }

    private static func search(_ s: OrtSuchtext) async -> MKMapItem? {
        switch s.art {
        case .adresse:
            guard let request = MKGeocodingRequest(addressString: s.text) else { return nil }
            return try? await request.mapItems.first
        case .flughafen, .bahnhof, .ort:
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = s.text
            switch s.art {
            case .flughafen:
                request.resultTypes = .pointOfInterest
                request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.airport])
            case .bahnhof:
                request.resultTypes = .pointOfInterest
                request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.publicTransport])
            default:
                request.resultTypes = [.pointOfInterest, .address]
            }
            return try? await MKLocalSearch(request: request).start().mapItems.first
        }
    }
}

// MARK: - Standort-Erlaubnis

/// Fragt „Beim Verwenden der App“ und wartet auf die Antwort.
final class StandortErlaubnis: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<CLAuthorizationStatus, Never>?

    var status: CLAuthorizationStatus { manager.authorizationStatus }
    var erteilt: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    func anfragen() async -> CLAuthorizationStatus {
        guard status == .notDetermined else { return status }
        return await withCheckedContinuation { c in
            waiting = c
            manager.delegate = self
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        guard s != .notDetermined, let c = waiting else { return }
        waiting = nil
        c.resume(returning: s)
    }
}

// MARK: - Planen und Einstellungen

@Observable
final class PlaceReminderController {
    private static let enabledKey = "placeRemindersOn"

    struct Geplant: Identifiable, Equatable {
        let kandidat: OrtKandidat
        let ortName: String?
        var id: String { kandidat.id }
    }

    let session: AppSession
    private(set) var isOn: Bool
    private(set) var busy = false
    /// Zuletzt geplant (für die Liste „Geplant“).
    private(set) var geplant: [Geplant] = []
    /// Orte der nächsten 36 h, die nicht gefunden wurden oder keinen Ort haben.
    private(set) var nichtGefunden: [OrtKandidat] = []
    var message: String?

    @ObservationIgnored private let standort = StandortErlaubnis()
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var planning = false
    @ObservationIgnored private var replan = false

    init(session: AppSession) {
        self.session = session
        isOn = UserDefaults.standard.bool(forKey: Self.enabledKey)
    }

    private func setOn(_ on: Bool) {
        isOn = on
        UserDefaults.standard.set(on, forKey: Self.enabledKey)
    }

    func turnOn() async {
        busy = true
        message = nil
        defer { busy = false }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus != .authorized {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            guard granted else {
                message = "Mitteilungen sind nicht erlaubt. Einschalten in den iOS-Einstellungen unter Reisebuch → Mitteilungen."
                return
            }
        }
        let status = await standort.anfragen()
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            message = "Standort ist nicht erlaubt. Einschalten in den iOS-Einstellungen unter Reisebuch → Standort (Beim Verwenden der App)."
            return
        }
        setOn(true)
        await plan()
    }

    func turnOff() async {
        setOn(false)
        message = nil
        await removeAll()
        geplant = []
        nichtGefunden = []
    }

    /// Beim Abmelden: alle Orte weg, Schalter aus. Der Such-Cache liegt im Zwischenspeicher und wird dort gelöscht.
    func reset() {
        setOn(false)
        geplant = []
        nichtGefunden = []
        message = nil
        Task { await removeAll() }
    }

    /// Neu planen, kurz verzögert (beim Vorladen kommen viele Abläufe kurz nacheinander).
    func schedulePlan() {
        guard isOn else { return }
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await plan()
        }
    }

    /// Alle eigenen `ort-*` entfernen und neu anlegen. Läuft schon eine Planung, wird danach noch einmal geplant.
    func plan(now: Date? = nil) async {
        if planning { replan = true; return }
        planning = true
        defer { planning = false }
        repeat {
            replan = false
            await planOnce(now: now ?? Date())
        } while replan
    }

    private func planOnce(now: Date) async {
        guard isOn, session.isLoggedIn else { return }
        guard standort.erteilt else {
            message = "Standort ist nicht mehr erlaubt (iOS-Einstellungen → Reisebuch → Standort)."
            await removeAll()
            return
        }
        let kandidaten = OrtAuswahl.kandidaten(session.cachedActiveTrips(now: now), now: now)
        var cache = OrtSuche.loadCache()
        var treffer: [String: OrtTreffer] = [:]
        var fehlt: [OrtKandidat] = []
        for k in kandidaten where treffer.count < OrtAuswahl.maxGeplant {
            if let hit = await OrtSuche.finde(k.suche, cache: &cache, now: now) { treffer[k.id] = hit } else { fehlt.append(k) }
        }
        OrtSuche.saveCache(cache)
        guard isOn else { return }

        let auswahl = OrtAuswahl.zumPlanen(kandidaten, gefunden: Set(treffer.keys))
        await removeAll()
        let center = UNUserNotificationCenter.current()
        for k in auswahl {
            guard let hit = treffer[k.id], let coordinate = hit.coordinate else { continue }
            let content = UNMutableNotificationContent()
            content.title = k.titel
            content.body = k.text
            content.sound = .default
            content.userInfo = ["url": "/trips/\(k.tripId)"]
            let region = CLCircularRegion(center: coordinate, radius: k.radius, identifier: k.id)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            let trigger = UNLocationNotificationTrigger(region: region, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: k.id, content: content, trigger: trigger))
        }
        geplant = auswahl.map { Geplant(kandidat: $0, ortName: treffer[$0.id]?.name) }
        nichtGefunden = fehlt
        if message?.hasPrefix("Standort ist nicht mehr") == true { message = nil }
    }

    private func removeAll() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(OrtAuswahl.prefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
}

// ENDE PlaceReminders.swift
