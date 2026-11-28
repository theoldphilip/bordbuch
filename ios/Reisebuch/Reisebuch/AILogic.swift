//
//  AILogic.swift
//  Reisebuch
//
//  KI-Funktionen wie in der Web-App (Auftrag 0.8.0), ohne Oberfläche: Modelle für „Reise prüfen“ (TripReviewDialog.tsx), Recherche im
//  Internet (ResearchPanel.tsx) und KI-Einstellungen (settings/Ai.tsx), Sichtbarkeit der Knöpfe nach /ai/status und Rolle, Bodies der
//  Aufrufe, Übernahme des vorgeschlagenen Reisenamens. Getestet in AILogicTests.
//

import Foundation

// MARK: - Reise prüfen

nonisolated struct ReviewFinding: Decodable, Hashable {
    /// error, warning, hint
    let severity: String
    let title: String
    let text: String?
    let itemIds: [String]?
    let dayIds: [String]?
    let suggestion: String?
}

nonisolated struct TripReview: Decodable {
    /// pending, done, failed
    let status: String
    let summary: String?
    let findings: [ReviewFinding]?
    let error: String?
    let finishedAt: String?
    let model: String?
}

nonisolated struct TripReviewState: Decodable {
    let review: TripReview?
    let stale: Bool?
}

enum ReviewLogic {
    static func rank(_ severity: String) -> Int {
        switch severity {
        case "error": return 0
        case "warning": return 1
        default: return 2
        }
    }

    /// Fehler zuerst, dann Warnungen, dann Hinweise; innerhalb gleicher Schwere wie geliefert.
    static func sorted(_ findings: [ReviewFinding]) -> [ReviewFinding] {
        findings.enumerated().sorted { a, b in
            rank(a.element.severity) != rank(b.element.severity) ? rank(a.element.severity) < rank(b.element.severity) : a.offset < b.offset
        }.map(\.element)
    }

    /// Symbol und Bezeichnung wie die Web-App.
    static func label(_ severity: String) -> (icon: String, label: String) {
        switch severity {
        case "error": return ("⛔", "Fehler")
        case "warning": return ("⚠️", "Warnung")
        default: return ("💡", "Hinweis")
        }
    }

    /// Farbe: Fehler rot, Warnung orange, Hinweis neutral (Web: check-error, check-warning, ohne Klasse).
    static func colorName(_ severity: String) -> String {
        switch severity {
        case "error": return "red"
        case "warning": return "orange"
        default: return "secondary"
        }
    }

    /// „1 Fehler · 2 Warnungen · 0 Hinweise“ bzw. „Keine Auffälligkeiten.“
    static func countText(_ findings: [ReviewFinding]) -> String {
        if findings.isEmpty { return "Keine Auffälligkeiten." }
        let e = findings.filter { $0.severity == "error" }.count
        let w = findings.filter { $0.severity == "warning" }.count
        let h = findings.filter { $0.severity != "error" && $0.severity != "warning" }.count
        return "\(e) Fehler · \(w) \(w == 1 ? "Warnung" : "Warnungen") · \(h) \(h == 1 ? "Hinweis" : "Hinweise")"
    }
}

/// Abfragen, solange etwas läuft; bei done/failed (oder ohne Ergebnis) aufhören.
enum Polling {
    static func shouldContinue(_ status: String?) -> Bool { status == "pending" }
}

// MARK: - Recherche

nonisolated struct ResearchSuggestion: Decodable, Identifiable {
    struct Target: Decodable { let kind: String; let index: Int }
    struct Field: Decodable { let field: String; let value: String }
    struct Detail: Decodable { let key: String; let value: String }
    struct Source: Decodable { let title: String?; let url: String }
    struct RouteDay: Decodable {
        let date: String
        let kind: String
        let portName: String?
        let country: String?
        let arrival: String?
        let departure: String?
    }
    struct Route: Decodable { let shipName: String?; let days: [RouteDay] }

    let id: String
    let target: Target?
    let title: String
    let fields: [Field]?
    let details: [Detail]?
    let infos: [Info]?
    let note: String?
    let sources: [Source]?
    let route: Route?
    let accepted: Bool?
}

nonisolated struct ResearchDiagnostics: Decodable {
    let queries: [String]?
    let fetched: [String]?
    let sourcesFound: Int?
    let droppedNoSource: Int?
    let droppedInvalid: Int?
    let notes: String?
}

nonisolated struct Research: Decodable {
    let status: String
    let summary: String?
    let error: String?
    let mode: String?
    let suggestions: [ResearchSuggestion]?
    let diagnostics: ResearchDiagnostics?
}

nonisolated struct ResearchState: Decodable {
    let research: Research?
}

nonisolated enum ResearchLogic {
    /// Link nur mit http(s); leer = kein Link; sonst Fehler.
    static func validURL(_ text: String) -> (url: String?, error: String?) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return (nil, nil) }
        let lower = t.lowercased()
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://"), URL(string: t)?.host() != nil else {
            return (nil, "Der Link muss mit http:// oder https:// beginnen.")
        }
        return (t, nil)
    }

    static func startBody(mode: String, url: String?) -> [String: JSONValue] {
        ["mode": .string(mode), "url": url.map { .string($0) } ?? .null]
    }

    static func acceptBody(_ ids: [String]) -> [String: JSONValue] {
        ["ids": .array(ids.map { .string($0) })]
    }

    /// Noch nicht übernommene Funde.
    static func open(_ r: Research) -> [ResearchSuggestion] {
        (r.suggestions ?? []).filter { $0.accepted != true }
    }

    static let fieldLabels: [String: String] = [
        "location": "Ort / Adresse", "startTz": "Zeitzone Beginn", "endTz": "Zeitzone Ende", "endLocal": "Ende", "provider": "Anbieter",
        "country": "Land", "timezone": "Zeitzone", "arrival": "Ankunft", "departure": "Abfahrt", "allAboard": "Alle an Bord",
    ]
}

// MARK: - Sichtbarkeit

struct AIFeatures: Equatable {
    let status: AIStatus?
    let role: String?

    private var editor: Bool { role == "owner" || role == "editor" }

    /// „🔍 Prüfen“ sehen (Betrachter sehen das gespeicherte Ergebnis).
    var showReview: Bool { status?.review == true }
    var canStartReview: Bool { showReview && editor }
    /// „Im Internet ergänzen“ in den Vorschlägen.
    var showResearch: Bool { status?.research == true && editor }
    /// „Aus Dokumenten“ bei „Neue Reise“.
    var aiImport: Bool { status?.enabled == true }
    var placeLookup: Bool { status?.placeLookup == true && editor }
}

// MARK: - Vorschläge bearbeiten, Reisename

nonisolated enum ProposalEdit {
    /// Formularwerte über die Vorschlagsdaten legen: was das Formular nicht kennt, bleibt; details kommen schon zusammengeführt.
    static func replaceData(original: [String: JSONValue], payload: [String: JSONValue]) -> [String: JSONValue] {
        original.merging(payload) { _, new in new }
    }

    /// Item aus Vorschlagsdaten (für das Formular); fehlende Pflichtfelder leer.
    static func item(from data: [String: JSONValue]) -> Item? {
        var d = data
        d["id"] = .string("")
        if d["title"] == nil || d["title"] == .null { d["title"] = .string("") }
        if d["startLocal"] == nil || d["startLocal"] == .null { d["startLocal"] = .string("") }
        if d["type"] == nil || d["type"] == .null { d["type"] = .string("note") }
        guard let json = try? JSONEncoder().encode(d) else { return nil }
        return try? JSONDecoder().decode(Item.self, from: json)
    }
}

enum TripTitle {
    static let placeholder = "Neue Reise"

    /// Vorschlag der KI nur übernehmen, solange die Reise noch „Neue Reise“ heißt.
    static func adopt(current: String, suggestion: String?) -> String? {
        guard current == placeholder, let s = suggestion?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty,
              s != placeholder else { return nil }
        return s
    }
}

// MARK: - KI-Einstellungen

nonisolated struct AIProviderState: Decodable, Identifiable, Equatable {
    /// anthropic, openai, gemini
    let id: String
    let label: String
    let configured: Bool
    /// settings, env oder nil
    let source: String?
    let keyHint: String?
    let model: String?
    let defaultModel: String?
}

nonisolated struct AIConfig: Decodable {
    struct Active: Decodable { let id: String; let label: String; let model: String? }
    let configurable: Bool?
    let primary: String?
    let fallback: Bool?
    let providers: [AIProviderState]
    let active: [Active]?
}

nonisolated struct AICheck: Decodable {
    struct Result: Decodable, Identifiable { let id: String; let label: String; let model: String?; let ok: Bool; let error: String? }
    let model: String?
    let results: [Result]?
}

enum AIConfigBody {
    static func primary(_ id: String) -> [String: JSONValue] { ["primary": .string(id)] }
    static func fallback(_ on: Bool) -> [String: JSONValue] { ["fallback": .bool(on)] }

    /// Neuer Schlüssel (getrimmt) bzw. nil = aus den Einstellungen entfernen.
    static func key(_ provider: String, _ key: String?) -> [String: JSONValue] {
        let k = key?.trimmingCharacters(in: .whitespacesAndNewlines)
        return ["providers": .object([provider: .object(["key": k.map { .string($0) } ?? .null])])]
    }

    /// Modell; leer = Standard (null).
    static func model(_ provider: String, _ model: String) -> [String: JSONValue] {
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
        return ["providers": .object([provider: .object(["model": m.isEmpty ? .null : .string(m)])])]
    }

    static let whereToGet: [String: (site: String, hint: String)] = [
        "anthropic": ("console.anthropic.com", "Settings → API Keys"),
        "openai": ("platform.openai.com", "API keys"),
        "gemini": ("aistudio.google.com", "Get API key"),
    ]
}

// MARK: - Aufrufe (nur App)

extension APIClient {
    func tripReview(tripId: String) async throws -> TripReviewState {
        try await send("GET", "/api/trips/\(Self.pathID(tripId))/review")
    }

    func startTripReview(tripId: String) async throws -> TripReviewState {
        try await send("POST", "/api/trips/\(Self.pathID(tripId))/review", body: EmptyBody())
    }

    func research(attachmentId: String) async throws -> ResearchState {
        try await send("GET", "/api/attachments/\(Self.pathID(attachmentId))/research")
    }

    func startResearch(attachmentId: String, mode: String, url: String?) async throws -> ResearchState {
        try await send("POST", "/api/attachments/\(Self.pathID(attachmentId))/research", body: ResearchLogic.startBody(mode: mode, url: url))
    }

    func acceptResearch(attachmentId: String, ids: [String]) async throws {
        _ = try await perform("POST", "/api/attachments/\(Self.pathID(attachmentId))/research/accept",
                              body: try JSONEncoder().encode(ResearchLogic.acceptBody(ids)), long: true)
    }

    func dismissResearch(attachmentId: String) async throws {
        let _: EmptyResponse = try await send("POST", "/api/attachments/\(Self.pathID(attachmentId))/research/dismiss", body: EmptyBody())
    }

    func aiConfig() async throws -> AIConfig {
        try await send("GET", "/api/ai/config")
    }

    func putAIConfig(_ body: JSONBody) async throws -> AIConfig {
        let data = try await perform("PUT", "/api/ai/config", body: try JSONEncoder().encode(body), long: true)
        return try Self.decode(AIConfig.self, from: data)
    }

    func aiCheck() async throws -> AICheck {
        let data = try await perform("POST", "/api/ai/check", body: Data("{}".utf8), long: true)
        return try Self.decode(AICheck.self, from: data)
    }
}

// ENDE AILogic.swift
