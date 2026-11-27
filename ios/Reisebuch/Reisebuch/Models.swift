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

/// Beliebiger JSON-Wert. Wird für `details` gebraucht: Beim Übernehmen der Reisetag-Abfrage schickt die App alle
/// bisherigen Schlüssel unverändert zurück (der Server ersetzt `details` als Ganzes), auch Zahlen oder null.
enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let d = try? c.decode(Double.self) { self = .number(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case let .string(s): try c.encode(s)
        case let .number(d): try c.encode(d)
        case let .bool(b): try c.encode(b)
        case .null: try c.encodeNil()
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }

    /// Lesbarer Text für die Anzeige; null, Listen und Objekte haben keinen.
    var text: String? {
        switch self {
        case let .string(s): return s
        case let .number(d): return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        case let .bool(b): return b ? "ja" : "nein"
        default: return nil
        }
    }
}

/// `details` eines Eintrags: die rohen Werte (zum Zurückschicken) und daraus die Texte (zur Anzeige).
/// Ein abweichender Wert macht die Antwort nicht unlesbar; ohne Text wird er nur nicht angezeigt.
struct StringMap: Codable, Hashable {
    let raw: [String: JSONValue]
    var values: [String: String] { raw.compactMapValues(\.text) }

    init(raw: [String: JSONValue]) { self.raw = raw }

    init(from decoder: Decoder) throws {
        raw = (try? decoder.singleValueContainer().decode([String: JSONValue].self)) ?? [:]
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(raw)
    }
}

// MARK: - KI-Status und Reisetag-Abfrage

struct AIStatus: Codable {
    let enabled: Bool?
    let placeLookup: Bool?
}

struct PlaceLookupSource: Codable, Hashable {
    let title: String?
    let url: String?
}

struct PlaceLookupFinding: Codable, Hashable {
    let key: String
    let label: String
    let value: String
    /// Was bisher eingetragen ist, zum Vergleich.
    let current: String?
    let source: PlaceLookupSource?
    let note: String?
}

struct PlaceLookup: Codable, Hashable {
    /// pending, done, failed
    let status: String
    let startedAt: String?
    let finishedAt: String?
    let error: String?
    let summary: String?
    let searches: Int?
    let queries: [String]?
    let findings: [PlaceLookupFinding]?
}

struct PlaceLookupResponse: Codable {
    let lookup: PlaceLookup?
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
