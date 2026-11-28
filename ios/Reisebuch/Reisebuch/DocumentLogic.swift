//
//  DocumentLogic.swift
//  Reisebuch (App und ReisebuchShare)
//
//  Dokumente und KI-Vorschläge (Auftrag 0.7.0), ohne Oberfläche: Modelle von Anhang und Analyse (docs/API.md „Dokument-Analyse“),
//  Vorbelegung übernehmen/überspringen und Aufbau des apply-Bodys (wie DocReview.tsx), Status-Texte, Mehrteil-Body für das Hochladen
//  (als Datei gestreamt, damit die Teilen-Erweiterung nichts doppelt im Speicher hält). Getestet in DocumentTests.
//

import Foundation
import UniformTypeIdentifiers

// MARK: - Modelle

nonisolated struct Attachment: Codable, Hashable, Identifiable {
    let id: String
    let tripId: String?
    let itemId: String?
    let filename: String
    let mime: String?
    let size: Int?
    let createdAt: String?
    /// null, pending, grouped, done, failed, applied, dismissed
    let analysisStatus: String?
    let analysisError: String?
}

nonisolated struct UploadResponse: Codable {
    let attachment: Attachment?
    let aiEnabled: Bool?
    let analyzable: Bool?
}

nonisolated struct ItemProposal: Decodable {
    struct Match: Decodable {
        let itemId: String
        let title: String?
        let reason: String?
        let changes: [String]?
    }
    let index: Int?
    /// Roh, damit `apply` die Daten unverändert zurückschickt.
    let data: [String: JSONValue]
    /// high, medium, low
    let confidence: String?
    let match: Match?
    let problems: [String]?
}

nonisolated struct CruiseProposal: Decodable {
    struct Match: Decodable {
        let cruiseId: String
        let shipName: String?
        let reason: String?
    }
    let data: [String: JSONValue]
    let match: Match?
    let newDays: Int?
    let updatedDays: Int?
    let problems: [String]?
}

nonisolated struct AnalysisView: Decodable {
    struct File: Decodable { let id: String; let filename: String }
    let status: String?
    let attachment: Attachment?
    let files: [File]?
    let documentKind: String?
    let summary: String?
    let warnings: [String]?
    let items: [ItemProposal]?
    let cruise: CruiseProposal?
    /// Vorschlag für den Reisenamen (übernommen, solange die Reise „Neue Reise“ heißt).
    var suggestedTripTitle: String? = nil
}

// MARK: - Vorschläge

nonisolated enum DocReviewLogic {
    /// Vorbelegung wie DocReview.tsx: übernehmen, außer bei Problemen (seit 0.8.0 auch bei unsicherer Erkennung).
    static func defaultApply(_ p: ItemProposal) -> Bool {
        (p.problems ?? []).isEmpty
    }

    static func defaultApply(_ c: CruiseProposal) -> Bool {
        (c.problems ?? []).isEmpty
    }

    /// Body für POST /attachments/:id/apply: create ohne match, update mit itemId aus match, skip; data unverändert.
    static func applyBody(items: [(proposal: ItemProposal, apply: Bool)],
                          cruise: (proposal: CruiseProposal, apply: Bool)?) -> [String: JSONValue] {
        let list: [JSONValue] = items.map { entry in
            var o: [String: JSONValue] = ["data": .object(entry.apply ? entry.proposal.data : [:])]
            if !entry.apply {
                o["action"] = .string("skip")
            } else if let m = entry.proposal.match {
                o["action"] = .string("update")
                o["itemId"] = .string(m.itemId)
            } else {
                o["action"] = .string("create")
            }
            return .object(o)
        }
        var body: [String: JSONValue] = ["items": .array(list)]
        if let cruise {
            var c: [String: JSONValue] = ["data": .object(cruise.proposal.data)]
            if !cruise.apply {
                c["action"] = .string("skip")
            } else if let m = cruise.proposal.match {
                c["action"] = .string("update")
                c["cruiseId"] = .string(m.cruiseId)
            } else {
                c["action"] = .string("create")
            }
            body["cruise"] = .object(c)
        } else {
            body["cruise"] = .null
        }
        return body
    }

    static func confidenceText(_ c: String?) -> String {
        switch c {
        case "high": return "sicher"
        case "low": return "unsicher"
        default: return "prüfen"
        }
    }

    /// Lesbarer Text eines Werts aus `data`.
    static func text(_ data: [String: JSONValue], _ key: String) -> String? {
        guard let t = data[key]?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }
}

// MARK: - Status der Dokumente

nonisolated enum DocumentStatus {
    /// Text zum Status; nil = nichts anzeigen.
    static func text(_ a: Attachment) -> String? {
        switch a.analysisStatus {
        case "pending": return "Wird gelesen …"
        case "done": return "Vorschläge prüfen"
        case "failed": return "Nicht gelesen" + (a.analysisError.map { ": \($0)" } ?? "")
        case "applied": return "Übernommen"
        default: return nil
        }
    }

    /// Sichtbare Dokumente, neueste oben; Teile einer gemeinsamen Auswertung („grouped“) ausgeblendet.
    static func visible(_ list: [Attachment]) -> [Attachment] {
        list.filter { $0.analysisStatus != "grouped" }.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }

    static func anyPending(_ list: [Attachment]) -> Bool {
        list.contains { $0.analysisStatus == "pending" }
    }

    /// Kennung des Dokuments in einer Mitteilung („Dokument gelesen“).
    static func documentId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["documentId"] as? String, !id.isEmpty else { return nil }
        return id
    }
}

// MARK: - Hochladen

nonisolated enum Upload {
    /// Grenze des Servers (MAX_UPLOAD_MB, Standard 25).
    static let maxBytes = 25 * 1024 * 1024

    enum Outcome: Equatable {
        /// 202: wird im Hintergrund gelesen, Mitteilung folgt.
        case background
        /// 201: gespeichert (nicht lesbar oder KI aus).
        case saved
    }

    static func outcome(status: Int, response: UploadResponse?) -> Outcome {
        status == 202 ? .background : .saved
    }

    /// Body für POST /trips/:id/documents/group: erste ID führt.
    static func groupBody(_ ids: [String]) -> [String: JSONValue] {
        ["attachmentIds": .array(ids.map { .string($0) })]
    }

    /// Vorbelegung von „zusammen auswerten“: an bei mehreren Bildern, sonst aus.
    static func defaultGrouped(filenames: [String]) -> Bool {
        let images = filenames.filter { ["jpg", "jpeg", "png", "heic", "gif", "webp"].contains(($0 as NSString).pathExtension.lowercased()) }
        return filenames.count > 1 && images.count == filenames.count
    }

    static func message(_ o: Outcome) -> String {
        switch o {
        case .background: return "Wird gelesen. Du bekommst eine Mitteilung, wenn die Vorschläge bereit sind."
        case .saved: return "Gespeichert."
        }
    }

    /// MIME-Typ aus der Dateiendung.
    static func mime(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        if ext == "eml" { return "message/rfc822" }  // iOS kennt die Endung nicht
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    /// Dateiname für den Kopf: Anführungszeichen und Zeilenumbrüche entfernt.
    static func safeFilename(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? "Dokument" : cleaned
    }

    static func header(boundary: String, filename: String, mime: String) -> Data {
        Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeFilename(filename))\"\r\nContent-Type: \(mime)\r\n\r\n".utf8)
    }

    static func footer(boundary: String) -> Data {
        Data("\r\n--\(boundary)--\r\n".utf8)
    }

    /// Schreibt den Mehrteil-Body in eine temporäre Datei; die Quelle wird in Stücken kopiert.
    static func writeBody(from source: URL, filename: String, mime: String, boundary: String) throws -> URL {
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString).bin")
        FileManager.default.createFile(atPath: out.path, contents: nil)
        let writer = try FileHandle(forWritingTo: out)
        defer { try? writer.close() }
        try writer.write(contentsOf: header(boundary: boundary, filename: filename, mime: mime))
        let reader = try FileHandle(forReadingFrom: source)
        defer { try? reader.close() }
        while let chunk = try reader.read(upToCount: 512 * 1024), !chunk.isEmpty {
            try writer.write(contentsOf: chunk)
        }
        try writer.write(contentsOf: footer(boundary: boundary))
        return out
    }

    static func fileSize(_ url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
}

// ENDE DocumentLogic.swift
