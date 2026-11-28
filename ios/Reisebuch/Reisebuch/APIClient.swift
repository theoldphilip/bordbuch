//
//  APIClient.swift
//  Reisebuch
//
//  Zugriff auf die REST-API von Reisebuch (docs/API.md). Jede Anfrage außer Anmeldung und Version
//  trägt "Authorization: Bearer <token>". Fehlermeldungen sind deutsch und für Philip verständlich.
//  Gehört zu App und ReisebuchShare (darum nonisolated).
//

import Foundation

nonisolated enum APIError: LocalizedError, Equatable {
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

nonisolated struct APIClient {
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

    /// Für Hochladen, erneutes Lesen und Übernehmen (dauert bis etwa eine Minute).
    private static let longSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
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

    /// Reise im Detail als rohe Antwort (für den Zwischenspeicher) und gelesen.
    func tripDetailRaw(tripId: String) async throws -> (data: Data, detail: TripDetail) {
        let data = try await perform("GET", "/api/trips/\(Self.pathID(tripId))", body: nil)
        return (data, try Self.decode(TripDetail.self, from: data))
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

    // MARK: Bearbeiten (0.6.0)

    /// JSON-Körper aus beliebigen Werten (Teil-Updates schicken nur die geänderten Felder).
    typealias JSONBody = [String: JSONValue]

    func createTrip(_ body: JSONBody) async throws -> TripDetail {
        try await send("POST", "/api/trips", body: body)
    }

    func patchTrip(tripId: String, _ body: JSONBody) async throws {
        let _: EmptyResponse = try await send("PATCH", "/api/trips/\(Self.pathID(tripId))", body: body)
    }

    func deleteTrip(tripId: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/trips/\(Self.pathID(tripId))")
    }

    func createItem(tripId: String, _ body: JSONBody) async throws -> Item {
        try await send("POST", "/api/trips/\(Self.pathID(tripId))/items", body: body)
    }

    func patchItem(itemId: String, _ body: JSONBody) async throws -> Item {
        try await send("PATCH", "/api/items/\(Self.pathID(itemId))", body: body)
    }

    func deleteItem(itemId: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/items/\(Self.pathID(itemId))")
    }

    func patchCruise(cruiseId: String, _ body: JSONBody) async throws {
        let _: EmptyResponse = try await send("PATCH", "/api/cruises/\(Self.pathID(cruiseId))", body: body)
    }

    func addCruiseDay(cruiseId: String, _ body: JSONBody) async throws {
        let _: EmptyResponse = try await send("POST", "/api/cruises/\(Self.pathID(cruiseId))/days", body: body)
    }

    func patchCruiseDay(dayId: String, _ body: JSONBody) async throws {
        let _: EmptyResponse = try await send("PATCH", "/api/cruise-days/\(Self.pathID(dayId))", body: body)
    }

    func deleteCruiseDay(dayId: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/cruise-days/\(Self.pathID(dayId))")
    }

    /// Hinweis quittieren bzw. zurücknehmen (Rolle editor). 404: Hinweis nicht mehr aktuell.
    func ackWarning(tripId: String, key: String, ack: Bool) async throws {
        let path = "/api/trips/\(Self.pathID(tripId))/warnings/\(Self.pathID(key))/ack"
        if ack {
            let _: EmptyResponse = try await send("PUT", path, body: EmptyBody())
        } else {
            let _: EmptyResponse = try await send("DELETE", path)
        }
    }

    // MARK: Dokumente (0.7.0)

    /// Datei eines Anhangs (mit Token).
    func downloadAttachment(id: String) async throws -> Data {
        try await perform("GET", "/api/attachments/\(Self.pathID(id))", body: nil, long: true)
    }

    func deleteAttachment(id: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/attachments/\(Self.pathID(id))")
    }

    func analysis(attachmentId: String) async throws -> AnalysisView {
        try await send("GET", "/api/attachments/\(Self.pathID(attachmentId))/analysis")
    }

    func applyAnalysis(attachmentId: String, _ body: JSONBody) async throws {
        let data = try JSONEncoder().encode(body)
        _ = try await perform("POST", "/api/attachments/\(Self.pathID(attachmentId))/apply", body: data, long: true)
    }

    func dismissAnalysis(attachmentId: String) async throws {
        let _: EmptyResponse = try await send("POST", "/api/attachments/\(Self.pathID(attachmentId))/dismiss", body: EmptyBody())
    }

    /// Erneut lesen; dauert bis etwa eine Minute.
    func reanalyze(attachmentId: String) async throws {
        _ = try await perform("POST", "/api/attachments/\(Self.pathID(attachmentId))/analyze", body: Data("{}".utf8), long: true)
    }

    /// Lädt eine Datei hoch (POST /trips/:id/documents?background=1), Body aus einer Datei gestreamt.
    func uploadDocument(tripId: String, itemId: String? = nil, file: URL, filename: String) async throws -> Upload.Outcome {
        var path = "/api/trips/\(Self.pathID(tripId))/documents?background=1"
        if let itemId { path += "&itemId=\(Self.pathID(itemId))" }
        let (status, data) = try await uploadMultipart(path: path, file: file, filename: filename)
        return Upload.outcome(status: status, response: try? JSONDecoder().decode(UploadResponse.self, from: data))
    }

    /// Nur speichern, ohne Analyse (für „zusammen auswerten“): POST /trips/:id/attachments.
    func uploadAttachment(tripId: String, file: URL, filename: String) async throws -> Attachment {
        let (_, data) = try await uploadMultipart(path: "/api/trips/\(Self.pathID(tripId))/attachments", file: file, filename: filename)
        return try Self.decode(Attachment.self, from: data)
    }

    /// Mehrere hochgeladene Dateien als eine Unterlage auswerten (erste führt), im Hintergrund.
    func analyzeGroup(tripId: String, attachmentIds: [String]) async throws -> Upload.Outcome {
        let body = try JSONEncoder().encode(Upload.groupBody(attachmentIds))
        let data = try await perform("POST", "/api/trips/\(Self.pathID(tripId))/documents/group?background=1", body: body, long: true)
        _ = data
        return .background
    }

    private func uploadMultipart(path: String, file: URL, filename: String) async throws -> (Int, Data) {
        guard Upload.fileSize(file) <= Upload.maxBytes else {
            throw APIError.other("„\(filename)“ ist größer als 25 MB.")
        }
        guard let url = URL(string: baseURL.absoluteString + path) else { throw APIError.invalidAddress }
        let boundary = "Reisebuch-\(UUID().uuidString)"
        let body = try Upload.writeBody(from: file, filename: filename, mime: Upload.mime(for: filename), boundary: boundary)
        defer { try? FileManager.default.removeItem(at: body) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await Self.mapErrors { try await Self.longSession.upload(for: request, fromFile: body) }
        let http = try Self.check(response, data)
        return (http.statusCode, data)
    }

    // MARK: KI (0.8.0)

    func me() async throws -> User {
        try await send("GET", "/api/me")
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

    struct EmptyBody: Encodable {}
    struct EmptyResponse: Decodable {}

    static func pathID(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }

    func send<Response: Decodable>(_ method: String, _ path: String, authorized: Bool = true) async throws -> Response {
        try await send(method, path, body: Optional<EmptyBody>.none, authorized: authorized)
    }

    func send<Body: Encodable, Response: Decodable>(_ method: String, _ path: String, body: Body?,
                                                           authorized: Bool = true) async throws -> Response {
        let bodyData = try body.map { try JSONEncoder().encode($0) }
        let data = try await perform(method, path, body: bodyData, authorized: authorized)
        if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response { return empty }
        return try Self.decode(Response.self, from: data)
    }

    /// Führt die Anfrage aus und gibt die rohe Antwort zurück; Fehler werden zu APIError.
    func perform(_ method: String, _ path: String, body: Data?, authorized: Bool = true, long: Bool = false) async throws -> Data {
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

        let session = long ? Self.longSession : Self.session
        let (data, response) = try await Self.mapErrors { try await session.data(for: request) }
        _ = try Self.check(response, data)
        return data
    }

    /// Netzwerkfehler → APIError.
    private static func mapErrors(_ work: () async throws -> (Data, URLResponse)) async throws -> (Data, URLResponse) {
        do {
            return try await work()
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
    }

    /// Statuscode prüfen: 401 → abgemeldet, sonst Fehlertext des Servers.
    private static func check(_ response: URLResponse, _ data: Data) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw APIError.other("Keine gültige Antwort vom Server.") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
            throw APIError.server(status: http.statusCode, message: message)
        }
        return http
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
