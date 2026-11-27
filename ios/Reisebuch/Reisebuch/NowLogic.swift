//
//  NowLogic.swift
//  Reisebuch
//
//  Jetzt-Markierung und Ausgrauen im Ablauf, wie in der Web-App (web/src/pages/Trip.tsx: entryEnd, dayEnd, nowKey;
//  web/src/format.ts: localToInstant). Reine Funktionen, damit sie sich testen lassen.
//

import Foundation

enum NowLogic {
    /// Einträge, die sich über mehrere Tage ziehen: Ihr Auftritt ist ein Zeitpunkt (Check-in bzw. Check-out), kein Zeitraum.
    static let spanTypes: Set<String> = ["hotel", "car_rental", "parking", "stop"]

    /// Ortszeit "YYYY-MM-DD[THH:MM]" in einer IANA-Zone → Zeitpunkt. Nur ein Datum: Ende = 23:59, Beginn = 00:00.
    static func instant(_ local: String, tz: String, dateOnlyAsEnd: Bool = true) -> Date? {
        let parts = local.split(separator: "T", maxSplits: 1).map(String.init)
        let dateParts = parts[0].split(separator: "-").compactMap { Int($0) }
        guard dateParts.count == 3 else { return nil }
        var hour = dateOnlyAsEnd ? 23 : 0
        var minute = dateOnlyAsEnd ? 59 : 0
        if parts.count == 2 {
            let timeParts = parts[1].split(separator: ":").compactMap { Int($0.prefix(2)) }
            guard timeParts.count >= 2 else { return nil }
            hour = timeParts[0]
            minute = timeParts[1]
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: tz) ?? TimeZone(identifier: "Europe/Zurich")!
        var c = DateComponents()
        c.year = dateParts[0]; c.month = dateParts[1]; c.day = dateParts[2]
        c.hour = hour; c.minute = minute
        return calendar.date(from: c)
    }

    /// Zeitpunkt, zu dem ein Auftritt beginnt (entryStart in Trip.tsx); nur ein Datum = Tagesbeginn.
    static func entryStart(_ e: TimelineEntry, defaultTz: String) -> Date {
        let local = e.role == "end" ? (e.item.endLocal ?? e.item.startLocal) : e.item.startLocal
        return instant(local, tz: e.timezone ?? defaultTz, dateOnlyAsEnd: false) ?? .distantFuture
    }

    /// Zeitpunkt, zu dem ein Auftritt vorbei ist (entryEnd in Trip.tsx).
    static func entryEnd(_ e: TimelineEntry, defaultTz: String) -> Date {
        let item = e.item
        let tz = e.timezone ?? defaultTz
        let local: String
        let zone: String
        if e.role == "end" {
            local = item.endLocal ?? item.startLocal
            zone = tz
        } else if !spanTypes.contains(item.type), let end = item.endLocal, !end.isEmpty {
            local = end
            zone = item.endTz ?? tz
        } else {
            local = item.startLocal
            zone = tz
        }
        return instant(local, tz: zone) ?? .distantFuture
    }

    /// Zeitpunkt, zu dem ein Kreuzfahrt-Tag vorbei ist (dayEnd in Trip.tsx): Abfahrt, sonst Tagesende.
    static func dayEnd(_ day: CruiseDay, defaultTz: String) -> Date {
        let tz = day.timezone ?? defaultTz
        if let dep = day.departure, !dep.isEmpty, day.kind != "sea" {
            return instant("\(day.date)T\(dep)", tz: tz) ?? .distantFuture
        }
        return instant(day.date, tz: tz) ?? .distantFuture
    }

    static func entryKey(_ e: TimelineEntry) -> String { "\(e.itemId)-\(e.role)" }
    static func dayKey(_ d: CruiseDay) -> String { "p:\(d.id)" }

    struct Element {
        let key: String
        let end: Date
        /// Zeitzone für die Uhrzeit der Markierung.
        let timezone: String
    }

    /// Alle Elemente des Ablaufs in Reihenfolge: je Tag erst der Kreuzfahrt-Tag, dann die Einträge.
    static func elements(_ timeline: Timeline) -> [Element] {
        let defaultTz = timeline.defaultTimezone ?? "Europe/Zurich"
        var result: [Element] = []
        for phase in timeline.phases {
            for day in phase.days {
                if let cd = day.cruiseDay {
                    result.append(Element(key: dayKey(cd), end: dayEnd(cd, defaultTz: defaultTz),
                                          timezone: cd.timezone ?? defaultTz))
                }
                for e in day.entries {
                    result.append(Element(key: entryKey(e), end: entryEnd(e, defaultTz: defaultTz),
                                          timezone: e.timezone ?? defaultTz))
                }
            }
        }
        return result
    }

    /// Das Element, vor dem „Jetzt“ steht: das erste, das noch nicht vorbei ist, aber nur, wenn schon eines vorbei ist.
    static func nowElement(_ timeline: Timeline, now: Date) -> Element? {
        let all = elements(timeline)
        guard all.contains(where: { $0.end < now }) else { return nil }
        return all.first { $0.end >= now }
    }

    /// Heutiges Datum "YYYY-MM-DD" in einer Zone.
    static func today(in tz: String, now: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: tz) ?? .current
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Uhrzeit "14:32" in einer Zone.
    static func clock(_ date: Date, tz: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.timeZone = TimeZone(identifier: tz) ?? .current
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}

// ENDE NowLogic.swift
