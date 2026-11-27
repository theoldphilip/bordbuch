//
//  WidgetStand.swift
//  Reisebuch (App und ReisebuchWidgetExtension)
//
//  Gemeinsames Datenformat zwischen App und Widget. Die App legt die nächsten Termine fertig in die App Group
//  (UserDefaults-Suite group.de.theoldphilip.Reisebuch, Schlüssel widget_stand); das Widget liest nur und geht nie ins Netz.
//  Ohne SwiftUI, damit die Datei in beiden Targets gleich übersetzt.
//

import Foundation

/// Ein Termin, wie ihn das Widget zeigt. Zeitpunkte in Millisekunden seit 1970.
nonisolated struct WidgetTermin: Codable, Equatable, Sendable {
    let start: Int64
    let ende: Int64
    /// IANA-Zone, in der die Uhrzeit angezeigt wird (Ortszeit des Termins).
    let tz: String
    let symbol: String
    let titel: String
    /// Fette Ortszeile (Terminal, Schalter, Gate, Kofferband, Gleis) oder nil.
    let ort: String?
    let reise: String
    let reiseId: String

    /// Wie gesynthetisiert, aber `ort` steht ohne Wert als null da (Format laut Auftrag).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(start, forKey: .start)
        try c.encode(ende, forKey: .ende)
        try c.encode(tz, forKey: .tz)
        try c.encode(symbol, forKey: .symbol)
        try c.encode(titel, forKey: .titel)
        try c.encode(ort, forKey: .ort)
        try c.encode(reise, forKey: .reise)
        try c.encode(reiseId, forKey: .reiseId)
    }

    var startDate: Date { Date(timeIntervalSince1970: TimeInterval(start) / 1000) }
    var endeDate: Date { Date(timeIntervalSince1970: TimeInterval(ende) / 1000) }

    static func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }
}

nonisolated struct WidgetStand: Codable, Equatable, Sendable {
    let updated: Int64
    let termine: [WidgetTermin]
}

/// Ablage in der App Group.
nonisolated enum WidgetStandStore {
    static let suiteName = "group.de.theoldphilip.Reisebuch"
    static let key = "widget_stand"

    static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }

    static func load(from defaults: UserDefaults? = defaults) -> WidgetStand? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetStand.self, from: data)
    }

    /// Speichert die Termine. Rückgabe: true, wenn sich `termine` gegenüber dem Gespeicherten geändert hat.
    @discardableResult
    static func save(_ termine: [WidgetTermin], now: Date = Date(), to defaults: UserDefaults? = defaults) -> Bool {
        let changed = load(from: defaults)?.termine != termine
        let stand = WidgetStand(updated: WidgetTermin.ms(now), termine: termine)
        if let data = try? JSONEncoder().encode(stand) { defaults?.set(data, forKey: key) }
        return changed
    }

    static func clear(in defaults: UserDefaults? = defaults) {
        defaults?.removeObject(forKey: key)
    }
}

/// Was das Widget zu einem Zeitpunkt zeigt. Keine Rechnung außer der Auswahl.
nonisolated enum WidgetAuswahl {
    /// Aktueller oder nächster Termin (erster mit ende >= jetzt) und der folgende.
    static func aktuell(_ termine: [WidgetTermin], now: Date) -> (termin: WidgetTermin?, folgender: WidgetTermin?) {
        let nowMs = WidgetTermin.ms(now)
        let offen = termine.filter { $0.ende >= nowMs }
        return (offen.first, offen.dropFirst().first)
    }

    /// Läuft der Termin schon? Nur, wenn er eine Dauer hat (Zeitpunkte wie „Alle an Bord“ laufen nie).
    static func laeuft(_ t: WidgetTermin, now: Date) -> Bool {
        let nowMs = WidgetTermin.ms(now)
        return t.start < t.ende && t.start <= nowMs && nowMs <= t.ende
    }

    /// „läuft · bis 11:58“, „09:40“ oder mehr als 24 h vorher „Sa. 09:40“, jeweils in der Ortszeit des Termins.
    static func zeitText(_ t: WidgetTermin, now: Date) -> String {
        if laeuft(t, now: now) { return "läuft · bis \(uhrzeit(t.endeDate, tz: t.tz))" }
        if t.startDate.timeIntervalSince(now) > 24 * 3600 {
            return "\(wochentag(t.startDate, tz: t.tz)) \(uhrzeit(t.startDate, tz: t.tz))"
        }
        return uhrzeit(t.startDate, tz: t.tz)
    }

    /// Eine Zeile für den Sperrbildschirm: „09:40 ✈️ Gate B12“, ohne Ort mit gekürztem Titel.
    static func inlineText(_ t: WidgetTermin, now: Date) -> String {
        let zeit = laeuft(t, now: now) ? "bis \(uhrzeit(t.endeDate, tz: t.tz))" : zeitText(t, now: now)
        if let ort = t.ort, !ort.isEmpty { return "\(zeit) \(t.symbol) \(ort)" }
        let titel = t.titel.count > 22 ? String(t.titel.prefix(21)) + "…" : t.titel
        return "\(zeit) \(t.symbol) \(titel)"
    }

    /// Zeitpunkte der Timeline-Einträge: jetzt, jeder Beginn, 24 h vor jedem Beginn (Wochentag fällt weg) und kurz
    /// nach jedem Ende (dann ist der Termin vorbei). Nur Zeitpunkte nach jetzt, sortiert, ohne Doppelte.
    static func eintragsZeiten(_ termine: [WidgetTermin], now: Date) -> [Date] {
        var result: Set<Date> = [now]
        for t in termine {
            for d in [t.startDate.addingTimeInterval(-24 * 3600), t.startDate, t.endeDate.addingTimeInterval(60)] where d > now {
                result.insert(d)
            }
        }
        return result.sorted()
    }

    static func uhrzeit(_ date: Date, tz: String) -> String {
        format(date, tz: tz, pattern: "HH:mm")
    }

    static func wochentag(_ date: Date, tz: String) -> String {
        format(date, tz: tz, pattern: "EEE")
    }

    private static func format(_ date: Date, tz: String, pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.timeZone = TimeZone(identifier: tz) ?? .current
        f.dateFormat = pattern
        return f.string(from: date)
    }
}

// ENDE WidgetStand.swift
