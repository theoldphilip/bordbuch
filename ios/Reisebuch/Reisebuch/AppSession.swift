//
//  AppSession.swift
//  Reisebuch
//
//  Anmeldezustand der App. Token im Schlüsselbund, Server-Adresse und Anzeigename in UserDefaults.
//  Antwortet der Server irgendwo mit 401, ist das Token ungültig: lokal abmelden, Anmeldung zeigen.
//  Dazu der Zwischenspeicher für offline lesen (ResponseCache): erst Gespeichertes zeigen, dann vom Server laden.
//

import Foundation
import Observation

@Observable
final class AppSession {
    static let defaultServer = "http://172.16.10.1:8080"

    private enum Keys {
        static let server = "serverAddress"
        static let displayName = "displayName"
        static let placeLookup = "placeLookupAvailable"
    }

    private(set) var serverAddress: String
    private(set) var displayName: String
    private(set) var token: String?
    /// Hinweis auf der Anmeldeseite, z. B. nach einem ungültigen Token.
    var loginNotice: String?
    /// Die letzte Anfrage an den Server scheiterte, weil er nicht erreichbar war (kein VPN, kein Netz).
    private(set) var isOffline = false
    /// Server bietet die Reisetag-Abfrage an (GET /api/ai/status); offline gilt der letzte bekannte Wert.
    private(set) var placeLookupAvailable: Bool

    var isLoggedIn: Bool { token != nil }

    init() {
        let defaults = UserDefaults.standard
        serverAddress = defaults.string(forKey: Keys.server) ?? Self.defaultServer
        displayName = defaults.string(forKey: Keys.displayName) ?? ""
        token = Keychain.readToken()
        placeLookupAvailable = defaults.bool(forKey: Keys.placeLookup)
    }

    var client: APIClient? {
        guard let url = APIClient.normalizedBaseURL(serverAddress) else { return nil }
        return APIClient(baseURL: url, token: token)
    }

    func login(server: String, username: String, password: String) async throws {
        guard let url = APIClient.normalizedBaseURL(server) else { throw APIError.invalidAddress }
        let response = try await APIClient(baseURL: url, token: nil).login(username: username, password: password)
        guard Keychain.saveToken(response.token) else {
            throw APIError.other("Das Token konnte nicht im Schlüsselbund gespeichert werden.")
        }
        let address = url.absoluteString
        UserDefaults.standard.set(address, forKey: Keys.server)
        UserDefaults.standard.set(response.user.displayName, forKey: Keys.displayName)
        serverAddress = address
        displayName = response.user.displayName
        token = response.token
        loginNotice = nil
    }

    /// Abmelden am Server; scheitert das (offline), wird trotzdem lokal abgemeldet.
    func logout() async {
        if let client { try? await client.logout() }
        clearLocal()
    }

    /// Führt eine Anfrage aus und meldet bei 401 lokal ab. Merkt sich, ob der Server erreichbar war.
    func call<T>(_ work: (APIClient) async throws -> T) async throws -> T {
        guard let client else { throw APIError.invalidAddress }
        do {
            let result = try await work(client)
            isOffline = false
            return result
        } catch APIError.unauthorized {
            clearLocal()
            loginNotice = "Die Anmeldung ist nicht mehr gültig. Bitte neu anmelden."
            throw APIError.other("Die Anmeldung ist nicht mehr gültig.")
        } catch APIError.unreachable {
            isOffline = true
            throw APIError.unreachable
        }
    }

    /// Abmelden löscht Token und den ganzen Zwischenspeicher: Daten der Familie gehören dann nicht mehr aufs Gerät.
    private func clearLocal() {
        Keychain.deleteToken()
        ResponseCache.clear()
        token = nil
    }

    // MARK: - KI-Status

    func refreshAIStatus() async {
        guard let status = try? await call({ try await $0.aiStatus() }) else { return }
        placeLookupAvailable = status.placeLookup == true
        UserDefaults.standard.set(placeLookupAvailable, forKey: Keys.placeLookup)
    }

    // MARK: - Reisen und Abläufe mit Zwischenspeicher

    func cachedTrips() -> Cached<[TripSummary]>? {
        guard let entry = ResponseCache.load(ResponseCache.tripsFile),
              let trips = try? APIClient.decode([TripSummary].self, from: entry.data) else { return nil }
        return Cached(value: trips, savedAt: entry.savedAt)
    }

    /// Lädt die Reiseliste vom Server, speichert sie und räumt Abläufe gelöschter Reisen weg.
    func fetchTrips() async throws -> [TripSummary] {
        let result = try await call { try await $0.tripsRaw() }
        ResponseCache.save(result.data, as: ResponseCache.tripsFile)
        ResponseCache.pruneTimelines(keeping: result.trips.map(\.id))
        return result.trips
    }

    func cachedTimeline(tripId: String) -> Cached<Timeline>? {
        guard let entry = ResponseCache.load(ResponseCache.timelineFile(tripId)),
              let timeline = try? APIClient.decode(Timeline.self, from: entry.data) else { return nil }
        return Cached(value: timeline, savedAt: entry.savedAt)
    }

    func fetchTimeline(tripId: String) async throws -> Timeline {
        let result = try await call { try await $0.timelineRaw(tripId: tripId) }
        ResponseCache.save(result.data, as: ResponseCache.timelineFile(tripId))
        return result.timeline
    }

    /// Lädt die Abläufe laufender und kommender Reisen vor, höchstens 5 gleichzeitig. Fehler bleiben still.
    func prefetchTimelines(for trips: [TripSummary], today: String? = nil) async {
        let today = today ?? Fmt.todayISO()
        let ids = trips.filter { !TripDates.isPast($0, today: today) }.map(\.id)
        await withTaskGroup(of: Void.self) { group in
            var next = 0
            func addNext() {
                guard next < ids.count else { return }
                let id = ids[next]
                next += 1
                group.addTask { [self] in _ = try? await self.fetchTimeline(tripId: id) }
            }
            for _ in 0..<min(5, ids.count) { addNext() }
            while await group.next() != nil { addNext() }
        }
    }
}

enum TripDates {
    /// Vergangen ist eine Reise, deren letzter Tag vor heute liegt. Reisen ohne Daten zählen als kommend.
    static func isPast(_ t: TripSummary, today: String) -> Bool {
        guard let end = t.effectiveEndDate ?? t.effectiveStartDate else { return false }
        return String(end.prefix(10)) < today
    }
}

// ENDE AppSession.swift
