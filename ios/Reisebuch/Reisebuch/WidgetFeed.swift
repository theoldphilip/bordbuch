//
//  WidgetFeed.swift
//  Reisebuch
//
//  Stellt aus den gespeicherten Abläufen (Zwischenspeicher aus 0.2.0) die Termine für das Widget zusammen
//  und legt sie in die App Group (WidgetStand.swift). Das Widget lädt nur neu, wenn sich die Termine geändert haben.
//

import Foundation
import WidgetKit

enum WidgetFeed {
    static let horizon: TimeInterval = 7 * 24 * 3600
    static let maxCount = 30

    /// Alle Elemente, deren Ende nach jetzt liegt und deren Beginn höchstens 7 Tage voraus ist, nach Beginn sortiert, höchstens 30.
    static func termine(_ trips: [(trip: TripSummary, timeline: Timeline)], now: Date) -> [WidgetTermin] {
        var found: [(order: Int, termin: WidgetTermin)] = []
        let limit = now.addingTimeInterval(horizon)
        for (trip, timeline) in trips {
            let defaultTz = timeline.defaultTimezone ?? "Europe/Zurich"
            for phase in timeline.phases {
                for day in phase.days {
                    if let cd = day.cruiseDay, let t = allAboard(cd, trip: trip, defaultTz: defaultTz),
                       t.endeDate > now, t.startDate <= limit {
                        found.append((found.count, t))
                    }
                    for e in day.entries {
                        let start = NowLogic.entryStart(e, defaultTz: defaultTz)
                        let end = NowLogic.entryEnd(e, defaultTz: defaultTz)
                        guard end > now, start <= limit, end != .distantFuture, start != .distantFuture else { continue }
                        found.append((found.count, termin(e, start: start, end: end, trip: trip, defaultTz: defaultTz)))
                    }
                }
            }
        }
        return found
            .sorted { $0.termin.start != $1.termin.start ? $0.termin.start < $1.termin.start : $0.order < $1.order }
            .prefix(maxCount)
            .map(\.termin)
    }

    /// Eintrag → Termin. Titel wie im Ablauf (zweiter Auftritt mit „Check-out · …“), Ort = fette Ortszeile.
    static func termin(_ e: TimelineEntry, start: Date, end: Date, trip: TripSummary, defaultTz: String) -> WidgetTermin {
        let item = e.item
        let titel = e.role == "end" ? "\(Labels.endLabel(item.type) ?? "Ende") · \(item.title)" : item.title
        let place = Labels.placeLine(item)
        return WidgetTermin(start: WidgetTermin.ms(start), ende: WidgetTermin.ms(end), tz: e.timezone ?? defaultTz,
                            symbol: Labels.itemType(item.type).icon, titel: titel, ort: place.isEmpty ? nil : place,
                            reise: trip.title, reiseId: trip.id)
    }

    /// Hafentag (kein Seetag): ein Zeitpunkt „Alle an Bord“, sonst die Abfahrt; ohne beides kein Termin.
    static func allAboard(_ cd: CruiseDay, trip: TripSummary, defaultTz: String) -> WidgetTermin? {
        guard cd.kind != "sea" else { return nil }
        let time = [cd.allAboard, cd.departure].compactMap { $0 }.first { !$0.isEmpty }
        let tz = cd.timezone ?? defaultTz
        guard let time, let at = NowLogic.instant("\(cd.date)T\(time)", tz: tz) else { return nil }
        let port = cd.portName.map { $0.isEmpty ? "" : " · \($0)" } ?? ""
        return WidgetTermin(start: WidgetTermin.ms(at), ende: WidgetTermin.ms(at), tz: tz, symbol: "🛳️",
                            titel: "Alle an Bord\(port)", ort: nil, reise: trip.title, reiseId: trip.id)
    }

    /// Termine neu zusammenstellen und ablegen; Widget nur bei Änderung neu laden.
    static func publish(_ termine: [WidgetTermin], now: Date = Date()) {
        if WidgetStandStore.save(termine, now: now) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Beim Abmelden: Stand löschen, Widget zeigt „Nicht angemeldet“.
    static func clear() {
        WidgetStandStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// ENDE WidgetFeed.swift
