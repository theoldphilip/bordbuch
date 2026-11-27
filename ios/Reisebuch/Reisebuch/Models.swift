//
//  Models.swift
//  Reisebuch
//
//  Antworten des Servers, gespiegelt aus web/src/types.ts (Vertrag: docs/API.md).
//  Feldnamen bleiben camelCase wie auf dem Server. Aufzählungen (kind, type, level …) sind
//  bewusst Strings: Kommt ein neuer Wert dazu, darf die App nicht beim Dekodieren scheitern.
//  Neue oder unbekannte Felder werden ignoriert, alles nicht Zwingende ist optional.
//

import Foundation

// MARK: - Anmeldung

struct User: Codable, Equatable {
    let id: String
    let username: String
    let displayName: String
    let isAdmin: Bool?
}

struct LoginResponse: Codable {
    let user: User
    let token: String
}

struct ServerVersion: Codable {
    let version: String?
    let builtAt: String?
    let schema: Int?
}

struct APIErrorBody: Codable {
    let error: String?
}

// MARK: - Reisen

struct TripSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let kind: String?
    let startDate: String?
    let endDate: String?
    let effectiveStartDate: String?
    let effectiveEndDate: String?
    let role: String?
    let ships: [String]?
    let memberCount: Int?
    let updatedAt: String?
}

// MARK: - Zusatzinfos

struct Info: Codable, Hashable {
    let label: String
    let value: String
    /// phone, emergency, email, link, text
    let kind: String
    /// user, document, ai, web (ai und web: bitte prüfen)
    let source: String?
}

// MARK: - Kreuzfahrt-Tag

struct CruiseDay: Codable, Identifiable, Hashable {
    let id: String
    let cruiseId: String?
    let date: String
    /// embarkation, port, sea, disembarkation
    let kind: String
    let portName: String?
    let country: String?
    let timezone: String?
    let arrival: String?
    let departure: String?
    let allAboard: String?
    let tender: Bool?
    let notes: String?
    let infos: [Info]?
}

// MARK: - Eintrag

struct Item: Codable, Identifiable, Hashable {
    let id: String
    let tripId: String?
    let type: String
    let title: String
    let startLocal: String
    let startTz: String?
    let endLocal: String?
    let endTz: String?
    let location: String?
    let confirmation: String?
    let provider: String?
    let notes: String?
    let cruiseDayId: String?
    let cost: Double?
    let currency: String?
    let paymentStatus: String?
    let paidAmount: Double?
    let dueDate: String?
    let details: StringMap?
    let infos: [Info]?

    var detailMap: [String: String] { details?.values ?? [:] }
}

/// `details` ist auf dem Server ein Objekt mit Text-Werten. Damit ein abweichender Wert (Zahl, Wahrheitswert,
/// null) die ganze Antwort nicht unlesbar macht, wird jeder Wert tolerant gelesen und alles andere übersprungen.
struct StringMap: Codable, Hashable {
    let values: [String: String]

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        var result: [String: String] = [:]
        if let c = try? decoder.container(keyedBy: Key.self) {
            for key in c.allKeys {
                if let s = try? c.decode(String.self, forKey: key) {
                    result[key.stringValue] = s
                } else if let i = try? c.decode(Int.self, forKey: key) {
                    result[key.stringValue] = String(i)
                } else if let d = try? c.decode(Double.self, forKey: key) {
                    result[key.stringValue] = String(d)
                } else if let b = try? c.decode(Bool.self, forKey: key) {
                    result[key.stringValue] = b ? "ja" : "nein"
                }
            }
        }
        values = result
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        for (k, v) in values { try c.encode(v, forKey: Key(stringValue: k)) }
    }
}

// MARK: - Timeline

struct TimelineEntry: Codable, Hashable {
    let itemId: String
    /// start oder end (zweiter Auftritt eines mehrtägigen Eintrags)
    let role: String
    let time: String?
    let timezone: String?
    let item: Item
}

struct TimelineDay: Codable, Hashable {
    let date: String
    let cruiseDay: CruiseDay?
    let entries: [TimelineEntry]
}

struct TimelinePhase: Codable, Hashable {
    let kind: String
    let title: String
    let cruiseId: String?
    let startDate: String?
    let endDate: String?
    let days: [TimelineDay]
}

struct WarningAck: Codable, Hashable {
    let by: String?
    let at: String?
}

struct TimelineWarning: Codable, Hashable {
    /// error, warning, info
    let level: String
    let code: String?
    let message: String
    let itemId: String?
    let cruiseId: String?
    let cruiseDayId: String?
    let personal: Bool?
    let role: String?
    let key: String?
    let ack: WarningAck?
}

struct Pace: Codable, Hashable {
    let enabled: Bool?
    let factor: Double?
    let extraMinutes: Int?
}

struct Timeline: Codable {
    let tripId: String
    let updatedAt: String?
    let defaultTimezone: String?
    let pace: Pace?
    let phases: [TimelinePhase]
    let warnings: [TimelineWarning]
}

// ENDE Models.swift
