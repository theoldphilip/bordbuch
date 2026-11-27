//
//  WidgetTests.swift
//  ReisebuchTests
//
//  Auftrag 0.3.0: Auswahl der Termine in der App, Auswahl im Widget, Zeitpunkte der Timeline-Einträge, Ablage.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct WidgetTests {

    private func utc(_ text: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: text)!
    }

    private func trip(_ id: String = "t1", title: String = "Testreise") throws -> TripSummary {
        try JSONDecoder().decode(TripSummary.self, from: Data("""
        {"id": "\(id)", "title": "\(title)", "kind": "cruise", "startDate": null, "endDate": null,
         "effectiveStartDate": null, "effectiveEndDate": null}
        """.utf8))
    }

    private func item(_ id: String, type: String, start: String, end: String? = nil, endTz: String? = nil,
                      details: String = "{}") -> String {
        let endText = end.map { "\"\($0)\"" } ?? "null"
        let endTzText = endTz.map { "\"\($0)\"" } ?? "null"
        return """
        {"id": "\(id)", "type": "\(type)", "title": "T-\(id)", "startLocal": "\(start)", "startTz": "Europe/Zurich",
         "endLocal": \(endText), "endTz": \(endTzText), "details": \(details), "infos": []}
        """
    }

    private func entry(_ itemJSON: String, id: String, role: String = "start") -> String {
        """
        {"itemId": "\(id)", "role": "\(role)", "time": null, "timezone": "Europe/Zurich", "item": \(itemJSON)}
        """
    }

    private func timeline(days: [String]) throws -> Timeline {
        try JSONDecoder().decode(Timeline.self, from: Data("""
        {"tripId": "t1", "defaultTimezone": "Europe/Zurich", "warnings": [], "phases": [
          {"kind": "trip", "title": "Reise", "days": [\(days.joined(separator: ","))]}]}
        """.utf8))
    }

    private func day(_ date: String, entries: [String], cruiseDay: String = "null") -> String {
        """
        {"date": "\(date)", "cruiseDay": \(cruiseDay), "entries": [\(entries.joined(separator: ","))]}
        """
    }

    // MARK: Auswahl in der App

    @Test func selectionWindowAndOrder() throws {
        // jetzt: 08.05.2027 10:00 Zürich (08:00 UTC)
        let now = utc("2027-05-08T08:00:00Z")
        let flight = item("f1", type: "flight", start: "2027-05-08T09:40", end: "2027-05-08T11:25", endTz: "Europe/Madrid",
                          details: #"{"terminal": "1", "gate": "B12", "pnr": "XYZ123"}"#)
        let train = item("z0", type: "train", start: "2027-05-08T07:00") // vorbei
        let hotel = item("h1", type: "hotel", start: "2027-05-08T15:00", end: "2027-05-10T11:00", endTz: "Europe/Zurich")
        let late = item("x9", type: "activity", start: "2027-05-15T10:01") // mehr als 7 Tage voraus
        let edge = item("x8", type: "activity", start: "2027-05-15T10:00") // genau 7 Tage
        let port = """
        {"id": "d1", "date": "2027-05-09", "kind": "port", "portName": "Lissabon", "timezone": "Europe/Lisbon",
         "departure": "18:00", "allAboard": "17:30"}
        """
        let sea = """
        {"id": "d2", "date": "2027-05-11", "kind": "sea", "timezone": null, "departure": null}
        """
        let t = try timeline(days: [
            day("2027-05-08", entries: [entry(train, id: "z0"), entry(flight, id: "f1"), entry(hotel, id: "h1")]),
            day("2027-05-09", entries: [], cruiseDay: port),
            day("2027-05-10", entries: [entry(hotel, id: "h1", role: "end")]),
            day("2027-05-11", entries: [], cruiseDay: sea),
            day("2027-05-15", entries: [entry(edge, id: "x8"), entry(late, id: "x9")]),
        ])
        let termine = WidgetFeed.termine([(trip: try trip(), timeline: t)], now: now)
        #expect(termine.map(\.titel) == ["T-f1", "T-h1", "Alle an Bord · Lissabon", "Check-out · T-h1", "T-x8"])

        let f = termine[0]
        #expect(f.ort == "Terminal 1 · Gate B12")
        #expect(f.symbol == "✈️")
        #expect(f.start == WidgetTermin.ms(utc("2027-05-08T07:40:00Z")))
        #expect(f.ende == WidgetTermin.ms(utc("2027-05-08T09:25:00Z"))) // Landung Madrid
        #expect(f.reise == "Testreise" && f.reiseId == "t1")
        // Keine Buchungsnummer im Widget-Stand.
        let json = String(decoding: try JSONEncoder().encode(termine), as: UTF8.self)
        #expect(!json.contains("XYZ123"))

        let ab = termine[2]
        #expect(ab.start == ab.ende)
        #expect(ab.start == WidgetTermin.ms(utc("2027-05-09T16:30:00Z"))) // 17:30 Lissabon (WEST)
        #expect(ab.tz == "Europe/Lisbon" && ab.symbol == "🛳️" && ab.ort == nil)
    }

    @Test func selectionLimitedTo30() throws {
        let now = utc("2027-05-08T00:00:00Z")
        let entries = (0..<40).map { i in
            entry(item("n\(i)", type: "note", start: String(format: "2027-05-08T%02d:%02d", 6 + i / 4, (i % 4) * 15)), id: "n\(i)")
        }
        let t = try timeline(days: [day("2027-05-08", entries: entries)])
        let termine = WidgetFeed.termine([(trip: try trip(), timeline: t)], now: now)
        #expect(termine.count == 30)
        #expect(termine.first?.titel == "T-n0")
        #expect(termine.last?.titel == "T-n29")
        #expect(termine.map(\.start) == termine.map(\.start).sorted())
    }

    @Test func departureWhenNoAllAboard() throws {
        let cd = try JSONDecoder().decode(CruiseDay.self, from: Data("""
        {"id": "d1", "date": "2027-05-09", "kind": "embarkation", "portName": "", "timezone": "Europe/Madrid", "departure": "18:00"}
        """.utf8))
        let t = WidgetFeed.allAboard(cd, trip: try trip(), defaultTz: "Europe/Zurich")
        #expect(t?.titel == "Alle an Bord")
        #expect(t?.start == WidgetTermin.ms(utc("2027-05-09T16:00:00Z")))
    }

    // MARK: Auswahl im Widget

    private func termin(_ start: String, _ ende: String, titel: String = "Flug", ort: String? = "Gate B12",
                        tz: String = "Europe/Zurich") -> WidgetTermin {
        WidgetTermin(start: WidgetTermin.ms(utc(start)), ende: WidgetTermin.ms(utc(ende)), tz: tz, symbol: "✈️",
                     titel: titel, ort: ort, reise: "R", reiseId: "t1")
    }

    @Test func widgetPicksRunningOrNext() {
        let a = termin("2027-05-08T07:40:00Z", "2027-05-08T09:58:00Z", titel: "A")
        let b = termin("2027-05-08T13:00:00Z", "2027-05-08T13:00:00Z", titel: "B", ort: nil)
        let c = termin("2027-05-10T07:40:00Z", "2027-05-10T09:00:00Z", titel: "C")
        let all = [a, b, c]
        // läuft
        var now = utc("2027-05-08T08:00:00Z")
        #expect(WidgetAuswahl.aktuell(all, now: now).termin?.titel == "A")
        #expect(WidgetAuswahl.aktuell(all, now: now).folgender?.titel == "B")
        #expect(WidgetAuswahl.zeitText(a, now: now) == "läuft · bis 11:58")
        #expect(WidgetAuswahl.inlineText(a, now: now) == "bis 11:58 ✈️ Gate B12")
        // kommt (unter 24 h): nur Uhrzeit; Zeitpunkt ohne Dauer läuft nie
        now = utc("2027-05-08T10:00:00Z")
        #expect(WidgetAuswahl.aktuell(all, now: now).termin?.titel == "B")
        #expect(WidgetAuswahl.zeitText(b, now: now) == "15:00")
        #expect(WidgetAuswahl.inlineText(b, now: now) == "15:00 ✈️ B")
        // mehr als 24 h vorher: mit Wochentag
        now = utc("2027-05-08T14:00:00Z")
        #expect(WidgetAuswahl.aktuell(all, now: now).termin?.titel == "C")
        #expect(WidgetAuswahl.zeitText(c, now: now) == "Mo. 09:40")
        // keiner mehr
        #expect(WidgetAuswahl.aktuell(all, now: utc("2027-05-11T00:00:00Z")).termin == nil)
        #expect(WidgetAuswahl.aktuell([], now: now).termin == nil)
    }

    @Test func zeitTextInLocalZone() {
        let ny = termin("2027-05-08T16:30:00Z", "2027-05-08T18:00:00Z", tz: "America/New_York")
        #expect(WidgetAuswahl.zeitText(ny, now: utc("2027-05-08T12:00:00Z")) == "12:30")
    }

    @Test func timelineEntryDates() {
        let now = utc("2027-05-08T08:00:00Z")
        let a = termin("2027-05-08T07:40:00Z", "2027-05-08T09:58:00Z")
        let c = termin("2027-05-10T07:40:00Z", "2027-05-10T09:00:00Z")
        let dates = WidgetAuswahl.eintragsZeiten([a, c], now: now)
        #expect(dates == [
            now,
            utc("2027-05-08T09:59:00Z"), // nach Ende von a
            utc("2027-05-09T07:40:00Z"), // 24 h vor c: ab dann ohne Wochentag
            utc("2027-05-10T07:40:00Z"), // Beginn c
            utc("2027-05-10T09:01:00Z"), // nach Ende c
        ])
        #expect(WidgetAuswahl.eintragsZeiten([], now: now) == [now])
    }

    // MARK: Ablage

    @Test func storeReportsChangesAndClears() throws {
        let suite = "reisebuch-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let a = termin("2027-05-08T07:40:00Z", "2027-05-08T09:58:00Z")
        #expect(WidgetStandStore.load(from: defaults) == nil)
        #expect(WidgetStandStore.save([a], now: utc("2027-05-08T07:00:00Z"), to: defaults) == true)
        #expect(WidgetStandStore.save([a], now: utc("2027-05-08T07:05:00Z"), to: defaults) == false)
        #expect(WidgetStandStore.load(from: defaults)?.updated == WidgetTermin.ms(utc("2027-05-08T07:05:00Z")))
        #expect(WidgetStandStore.save([], to: defaults) == true)
        // Format wie im Auftrag: updated und termine mit Millisekunden.
        let raw = try #require(defaults.data(forKey: WidgetStandStore.key))
        let obj = try JSONSerialization.jsonObject(with: raw) as? [String: Any]
        #expect(obj?["termine"] is [Any] && obj?["updated"] is NSNumber)
        WidgetStandStore.clear(in: defaults)
        #expect(WidgetStandStore.load(from: defaults) == nil)
    }
}

// ENDE WidgetTests.swift
