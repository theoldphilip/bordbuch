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

    func trips() async throws -> [TripSummary] {
        try await send("GET", "/api/trips")
    }

    func timeline(tripId: String) async throws -> Timeline {
        let id = tripId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? tripId
        return try await send("GET", "/api/trips/\(id)/timeline")
    }

    // MARK: Grundlage

    private struct EmptyBody: Encodable {}
    private struct EmptyResponse: Decodable {}

    private func send<Response: Decodable>(_ method: String, _ path: String, authorized: Bool = true) async throws -> Response {
        try await send(method, path, body: Optional<EmptyBody>.none, authorized: authorized)
    }

    private func send<Body: Encodable, Response: Decodable>(_ method: String, _ path: String, body: Body?,
                                                           authorized: Bool = true) async throws -> Response {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw APIError.invalidAddress }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authorized, let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
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
        if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response { return empty }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch let DecodingError.keyNotFound(key, ctx) {
            throw APIError.decoding("Feld \(key.stringValue) fehlt, \(Self.pathText(ctx.codingPath))")
        } catch let DecodingError.typeMismatch(_, ctx), let DecodingError.valueNotFound(_, ctx) {
            throw APIError.decoding("Feld \(Self.pathText(ctx.codingPath))")
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    private static func pathText(_ path: [CodingKey]) -> String {
        path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
    }
}

// ENDE APIClient.swift
