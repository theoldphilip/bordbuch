//
//  Keychain.swift
//  Reisebuch (App und ReisebuchShare)
//
//  Das Anmelde-Token liegt nur im Schlüsselbund (Service de.theoldphilip.Reisebuch, Account token). Ein Passwort wird nie gespeichert.
//  Seit 0.7.0 in der Zugriffsgruppe der App Group (group.de.theoldphilip.Reisebuch), damit die Teilen-Erweiterung es lesen kann.
//  Beim ersten Start von 0.7.0 zieht `migrate` das vorhandene Token einmal in die Gruppe um (Philip bleibt angemeldet).
//

import Foundation
import Security

/// Zugriff auf die Einträge des Tokens; abstrahiert, damit der Umzug testbar ist.
nonisolated protocol KeychainBackend {
    /// Alle Einträge des Tokens mit ihrer Zugriffsgruppe.
    func items() -> [(group: String?, data: Data)]
    /// Neu anlegen; group nil = Standardgruppe der App.
    func add(_ data: Data, group: String?) -> OSStatus
    /// Löscht in einer Gruppe; nil = in allen.
    func delete(group: String?)
}

nonisolated enum Keychain {
    static let group = "group.de.theoldphilip.Reisebuch"
    static let service = "de.theoldphilip.Reisebuch"
    static let account = "token"
    /// errSecMissingEntitlement: Die App darf die Gruppe nicht als Schlüsselbund-Gruppe nutzen.
    static let missingEntitlement: OSStatus = -34018

    enum Migration: Equatable {
        case nothing, alreadyInGroup, moved, missingEntitlement, failed(OSStatus)
    }

    static func readToken(_ backend: KeychainBackend = SystemKeychain()) -> String? {
        let all = backend.items()
        // In der Gruppe zuerst; ist der Umzug gescheitert, gilt der alte Eintrag weiter (nur die Erweiterung sieht ihn dann nicht).
        let entry = all.first { $0.group == group } ?? all.first
        return entry.flatMap { String(data: $0.data, encoding: .utf8) }
    }

    @discardableResult
    static func saveToken(_ token: String, _ backend: KeychainBackend = SystemKeychain()) -> Bool {
        let data = Data(token.utf8)
        backend.delete(group: nil)
        var status = backend.add(data, group: group)
        // Ohne Berechtigung für die Gruppe wenigstens in der App speichern (die Erweiterung sieht es dann nicht).
        if status == missingEntitlement { status = backend.add(data, group: nil) }
        return status == errSecSuccess
    }

    static func deleteToken(_ backend: KeychainBackend = SystemKeychain()) {
        backend.delete(group: nil)
    }

    /// Einmaliger Umzug: vorhandenes Token in die Gruppe kopieren, danach den alten Eintrag löschen.
    /// Fehlt die Berechtigung (-34018), bleibt alles, wie es war.
    static func migrate(_ backend: KeychainBackend = SystemKeychain()) -> Migration {
        let all = backend.items()
        if all.contains(where: { $0.group == group }) {
            for other in all where other.group != group { backend.delete(group: other.group) }
            return .alreadyInGroup
        }
        guard let old = all.first else { return .nothing }
        let status = backend.add(old.data, group: group)
        if status == missingEntitlement { return .missingEntitlement }
        guard status == errSecSuccess else { return .failed(status) }
        backend.delete(group: old.group)
        return .moved
    }
}

/// Der echte Schlüsselbund.
nonisolated struct SystemKeychain: KeychainBackend {
    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Keychain.service,
         kSecAttrAccount as String: Keychain.account]
    }

    func items() -> [(group: String?, data: Data)] {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let list = result as? [[String: Any]] else { return [] }
        return list.compactMap { entry in
            guard let data = entry[kSecValueData as String] as? Data else { return nil }
            return (group: entry[kSecAttrAccessGroup as String] as? String, data: data)
        }
    }

    func add(_ data: Data, group: String?) -> OSStatus {
        var query = base
        if let group { query[kSecAttrAccessGroup as String] = group }
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil)
    }

    func delete(group: String?) {
        var query = base
        if let group { query[kSecAttrAccessGroup as String] = group }
        SecItemDelete(query as CFDictionary)
    }
}

/// Server-Adresse und Anzeigename für die Teilen-Erweiterung (App Group, kein Geheimnis). Das Token steht nie hier.
nonisolated enum SharedStore {
    private static let serverKey = "serverAddress"
    private static let nameKey = "displayName"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: Keychain.group) }

    static var serverAddress: String? { defaults?.string(forKey: serverKey) }
    static var displayName: String? { defaults?.string(forKey: nameKey) }

    static func save(server: String, displayName: String) {
        defaults?.set(server, forKey: serverKey)
        defaults?.set(displayName, forKey: nameKey)
    }

    static func clear() {
        defaults?.removeObject(forKey: serverKey)
        defaults?.removeObject(forKey: nameKey)
    }
}

// ENDE Keychain.swift
