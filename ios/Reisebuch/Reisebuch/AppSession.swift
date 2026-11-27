//
//  AppSession.swift
//  Reisebuch
//
//  Anmeldezustand der App. Token im Schlüsselbund, Server-Adresse und Anzeigename in UserDefaults.
//  Antwortet der Server irgendwo mit 401, ist das Token ungültig: lokal abmelden, Anmeldung zeigen.
//

import Foundation
import Observation

@Observable
final class AppSession {
    static let defaultServer = "http://172.16.10.1:8080"

    private enum Keys {
        static let server = "serverAddress"
        static let displayName = "displayName"
    }

    private(set) var serverAddress: String
    private(set) var displayName: String
    private(set) var token: String?
    /// Hinweis auf der Anmeldeseite, z. B. nach einem ungültigen Token.
    var loginNotice: String?

    var isLoggedIn: Bool { token != nil }

    init() {
        let defaults = UserDefaults.standard
        serverAddress = defaults.string(forKey: Keys.server) ?? Self.defaultServer
        displayName = defaults.string(forKey: Keys.displayName) ?? ""
        token = Keychain.readToken()
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

    /// Führt eine Anfrage aus und meldet bei 401 lokal ab.
    func call<T>(_ work: (APIClient) async throws -> T) async throws -> T {
        guard let client else { throw APIError.invalidAddress }
        do {
            return try await work(client)
        } catch APIError.unauthorized {
            clearLocal()
            loginNotice = "Die Anmeldung ist nicht mehr gültig. Bitte neu anmelden."
            throw APIError.other("Die Anmeldung ist nicht mehr gültig.")
        }
    }

    private func clearLocal() {
        Keychain.deleteToken()
        token = nil
    }
}

// ENDE AppSession.swift
