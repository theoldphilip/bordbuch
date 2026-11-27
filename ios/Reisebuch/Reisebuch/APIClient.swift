//
//  APIClient.swift
//  Reisebuch
//
//  Zugriff auf die REST-API von Reisebuch (docs/API.md). Jede Anfrage außer Anmeldung und Version
//  trägt "Authorization: Bearer <token>". Fehlermeldungen sind deutsch und für Philip verständlich.
//

import Foundation

enum APIError: LocalizedError, Equatable {
    case invalidAddress
    case unreachable
    case insecureBlocked
    case unauthorized
    case server(status: Int, message: String?)
    case decoding(String)
    case other(String)

    var errorDescription: String? {
        switch self {
        case .invalidAddress:
            return "Die Server-Adresse ist ungültig."
        case .unreachable:
            return "Server nicht erreichbar. Ist das VPN an?"
        case .insecureBlocked:
            return "iOS blockiert die unverschlüsselte Verbindung zum Server (App Transport Security)."
        case .unauthorized:
            return "Benutzername oder Passwort falsch."
        case let .server(status, message):
            if let message, !message.isEmpty { return message }
            return "Der Server meldet einen Fehler (HTTP \(status))."
        case let .decoding(detail):
            return "Die Antwort des Servers ist unerwartet aufgebaut. (\(detail))"
        case let .other(text):
            return text
        }
    }
}

struct APIClient {
    let baseURL: URL
    var token: String?

    /// Macht aus der Eingabe eine Adresse: Leerzeichen und abschließender Schrägstrich weg, ohne Schema gilt http://.
    static func normalizedBaseURL(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        if text.isEmpty { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "http://" + text
        }
        guard let url = URL(string: text), url.host() != nil else { return nil }
        return url
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    // MARK: Endpunkte

    func login(username: String, password: String) async throws -> LoginResponse {
        struct Body: Encodable { let username: String; let password: String; let deviceName: String }
        return try await send("POST", "/api/auth/login",
                              body: Body(username: username, password: password, deviceName: "iPhone-App"),
                              authorized: false)
    }

    func logout() async throws {
        let _: EmptyResponse = try await send("POST", "/api/auth/logout", body: EmptyBody())
    }

    func version() async throws -> ServerVersion {
        try await send("GET", "/api/version", authorized: false)
    }

    /// Reiseliste als rohe Antwort (für den Zwischenspeicher) und gelesen.
    func tripsRaw() async throws -> (data: Data, trips: [TripSummary]) {
        let data = try await perform("GET", "/api/trips", body: nil)
        return (data, try Self.decode([TripSummary].self, from: data))
    }

    /// Ablauf einer Reise als rohe Antwort (für den Zwischenspeicher) und gelesen.
    func timelineRaw(tripId: String) async throws -> (data: Data, timeline: Timeline) {
        let data = try await perform("GET", "/api/trips/\(Self.pathID(tripId))/timeline", body: nil)
        return (data, try Self.decode(Timeline.self, from: data))
    }

    func aiStatus() async throws -> AIStatus {
        try await send("GET", "/api/ai/status")
    }

    func placeLookup(itemId: String) async throws -> PlaceLookup? {
        let r: PlaceLookupResponse = try await send("GET", "/api/items/\(Self.pathID(itemId))/place-lookup")
        return r.lookup
    }

    func startPlaceLookup(itemId: String) async throws -> PlaceLookup? {
        let r: PlaceLookupResponse = try await send("POST", "/api/items/\(Self.pathID(itemId))/place-lookup", body: EmptyBody())
        return r.lookup
    }

    /// Schreibt `details` eines Eintrags. Der Server ersetzt `details` als Ganzes: `details` muss alle Schlüssel enthalten.
    func patchItemDetails(itemId: String, details: [String: JSONValue]) async throws -> Item {
        struct Body: Encodable { let details: [String: JSONValue] }
        return try await send("PATCH", "/api/items/\(Self.pathID(itemId))", body: Body(details: details))
    }

    // MARK: Benachrichtigungen (APNs)

    /// Ob der Server an die iPhone-App senden kann (APNs-Schlüssel eingerichtet).
    func apnsStatus() async throws -> APNsStatus {
        try await send("GET", "/api/push/apns")
    }

    /// Meldet dieses iPhone an. Bewusst fester Gerätename statt des iOS-Namens (der enthält oft einen Personennamen).
    func registerAPNs(token: String) async throws {
        struct Body: Encodable { let token: String; let deviceName: String }
        let _: EmptyResponse = try await send("POST", "/api/push/apns", body: Body(token: token, deviceName: "iPhone-App"))
    }

    func unregisterAPNs(token: String) async throws {
        struct Body: Encodable { let token: String }
        let _: EmptyResponse = try await send("DELETE", "/api/push/apns", body: Body(token: token))
    }

    /// Schaltet Benachrichtigungen fürs Konto ein (dieselbe Einstellung wie in der Web-App).
    func enableNotificationsSetting() async throws {
        struct Notifications: Encodable { let enabled: Bool }
        struct Body: Encodable { let notifications: Notifications }
        let _: EmptyResponse = try await send("PATCH", "/api/me/settings", body: Body(notifications: Notifications(enabled: true)))
    }

    func pushTest() async throws -> PushTestResponse {
        try await send("POST", "/api/push/test", body: EmptyBody())
    }

    // MARK: Grundlage

    private struct EmptyBody: Encodable {}
    private struct EmptyResponse: Decodable {}

    private static func pathID(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }

    private func send<Response: Decodable>(_ method: String, _ path: String, authorized: Bool = true) async throws -> Response {
        try await send(method, path, body: Optional<EmptyBody>.none, authorized: authorized)
    }

    private func send<Body: Encodable, Response: Decodable>(_ method: String, _ path: String, body: Body?,
                                                           authorized: Bool = true) async throws -> Response {
        let bodyData = try body.map { try JSONEncoder().encode($0) }
        let data = try await perform(method, path, body: bodyData, authorized: authorized)
        if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response { return empty }
        return try Self.decode(Response.self, from: data)
    }

    /// Führt die Anfrage aus und gibt die rohe Antwort zurück; Fehler werden zu APIError.
    private func perform(_ method: String, _ path: String, body: Data?, authorized: Bool = true) async throws -> Data {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw APIError.invalidAddress }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authorized, let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .appTransportSecurityRequiresSecureConnection:
                throw APIError.insecureBlocked
            case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .timedOut,
                 .networkConnectionLost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed:
                throw APIError.unreachable
            case .cancelled:
                throw CancellationError()
            default:
                throw APIError.other("Verbindungsfehler: \(error.localizedDescription)")
            }
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.other("Keine gültige Antwort vom Server.") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
            throw APIError.server(status: http.statusCode, message: message)
        }
        return data
    }

    /// Liest eine Antwort; auch für gespeicherte Antworten aus dem Zwischenspeicher.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch let DecodingError.keyNotFound(key, ctx) {
            throw APIError.decoding("Feld \(key.stringValue) fehlt, \(pathText(ctx.codingPath))")
        } catch let DecodingError.typeMismatch(_, ctx), let DecodingError.valueNotFound(_, ctx) {
            throw APIError.decoding("Feld \(pathText(ctx.codingPath))")
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    private static func pathText(_ path: [CodingKey]) -> String {
        path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
    }
}

// ENDE APIClient.swift
