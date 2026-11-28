//
//  ResponseCache.swift
//  Reisebuch
//
//  Zwischenspeicher für offline lesen: die rohen JSON-Antworten von GET /api/trips und GET /api/trips/:id/timeline,
//  je eine Datei in Application Support/cache/. Der Zeitpunkt der Antwort ist das Änderungsdatum der Datei.
//  Dateischutz bis zur ersten Entsperrung, von der Sicherung ausgenommen. Abmelden löscht alles.
//

import Foundation

struct Cached<Value> {
    let value: Value
    let savedAt: Date
}

enum ResponseCache {
    static let tripsFile = "trips.json"

    static func timelineFile(_ tripId: String) -> String {
        // Nur sichere Zeichen im Dateinamen; IDs des Servers sind ohnehin einfach.
        let safe = tripId.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" }
        return "timeline-\(String(safe)).json"
    }

    static func costsFile(_ tripId: String) -> String {
        "costs-" + String(timelineFile(tripId).dropFirst("timeline-".count))
    }

    static func tripFile(_ tripId: String) -> String {
        "trip-" + String(timelineFile(tripId).dropFirst("timeline-".count))
    }

    /// Ordner des Zwischenspeichers; wird bei Bedarf angelegt und von der Sicherung ausgenommen.
    static var directory: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        var dir = base.appendingPathComponent("cache", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                     attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    static func save(_ data: Data, as name: String, at date: Date = Date()) {
        let url = directory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var fileURL = url
            try? fileURL.setResourceValues(values)
        } catch {
            // Ohne Zwischenspeicher geht es weiter, nur offline fehlt dann diese Antwort.
        }
    }

    static func load(_ name: String) -> (data: Data, savedAt: Date)? {
        let url = directory.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let date = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? Date()
        return (data, date)
    }

    /// Entfernt Abläufe und Reise-Details von Reisen, die nicht mehr in der Liste stehen.
    static func pruneTimelines(keeping tripIds: [String]) {
        let keep = Set(tripIds.map { timelineFile($0) } + tripIds.map { tripFile($0) } + tripIds.map { costsFile($0) })
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for file in files where (file.hasPrefix("timeline-") || file.hasPrefix("trip-") || file.hasPrefix("costs-")) && !keep.contains(file) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(file))
        }
    }

    /// Löscht den ganzen Zwischenspeicher (beim Abmelden).
    static func clear() {
        let dir = directory
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for file in files {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(file))
        }
    }

    static func fileNames() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
    }
}

// ENDE ResponseCache.swift
