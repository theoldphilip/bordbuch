//
//  NowLogicTests.swift
//  ReisebuchTests
//
//  Teil B (Jetzt-Markierung), Teil C (Übernehmen-Körper) und Teil A (Zwischenspeicher) von Auftrag 0.2.0.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct NowLogicTests {

    private func utc(_ text: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: text)!
    }

    private func itemJSON(_ id: String, type: String, start: String, startTz: String = "Europe/Zurich",
                          end: String? = nil, endTz: String? = nil, details: String = "{}") -> String {
        let endText = end.map { "\"\($0)\"" } ?? "null"
        let endTzText = endTz.map { "\"\($0)\"" } ?? "null"
        return """
        {"id": "\(id)", "type": "\(type)", "title": "\(id)", "startLocal": "\(start)", "startTz": "\(startTz)",
         "endLocal": \(endText), "endTz": \(endTzText), "details": \(details), "infos": []}
        """
    }

    private func entry(_ itemJSON: String, id: String, role: String = "start", tz: String = "Europe/Zurich") throws -> TimelineEntry {
        let json = """
        {"itemId": "\(id)", "role": "\(role)", "time": null, "timezone": "\(tz)", "item": \(itemJSON)}
        """
        return try JSONDecoder().decode(TimelineEntry.self, from: Data(json.utf8))
    }

    // MARK: Ortszeit → Zeitpunkt

    @Test func localToInstant() {
        #expect(NowLogic.instant("2027-05-08T09:40", tz: "Europe/Zurich") == utc("2027-05-08T07:40:00Z"))
        // Sommerzeit-Wechsel am 28.03.2027 um 02:00 (Europe/Zurich): davor +1, danach +2.
        #expect(NowLogic.instant("2027-03-28T01:30", tz: "Europe/Zurich") == utc("2027-03-28T00:30:00Z"))
        #expect(NowLogic.instant("2027-03-28T12:00", tz: "Europe/Zurich") == utc("2027-03-28T10:00:00Z"))
        // Rückstellung am 31.10.2027.
        #expect(NowLogic.instant("2027-10-31T12:00", tz: "Europe/Zurich") == utc("2027-10-31T11:00:00Z"))
        // Nur Datum: als Ende 23:59, als Beginn 00:00.
        #expect(NowLogic.instant("2027-05-08", tz: "Europe/Zurich") == utc("2027-05-08T21:59:00Z"))
        #expect(NowLogic.instant("2027-05-08", tz: "Europe/Zurich", dateOnlyAsEnd: false) == utc("2027-05-07T22:00:00Z"))
    }

    @Test func flightEndsInArrivalZone() throws {
        // Abflug Zürich 09:40 (MESZ), Landung New York 12:30 (EDT, UTC-4) → vorbei um 16:30 UTC.
        let e = try entry(itemJSON("f1", type: "flight", start: "2027-05-08T09:40", end: "2027-05-08T12:30",
                                   endTz: "America/New_York"), id: "f1")
        #expect(NowLogic.entryEnd(e, defaultTz: "Europe/Zurich") == utc("2027-05-08T16:30:00Z"))
    }

    @Test func entryEndPerType() throws {
        // Hotel: Check-in-Auftritt endet mit dem Check-in, nicht mit dem Check-out.
        let hotel = itemJSON("h1", type: "hotel", start: "2027-05-08T15:00", end: "2027-05-10T11:00", endTz: "Europe/Zurich")
        #expect(NowLogic.entryEnd(try entry(hotel, id: "h1"), defaultTz: "Europe/Zurich") == utc("2027-05-08T13:00:00Z"))
        // Check-out-Auftritt (role end): endLocal in der Zone des Auftritts.
        #expect(NowLogic.entryEnd(try entry(hotel, id: "h1", role: "end"), defaultTz: "Europe/Zurich") == utc("2027-05-10T09:00:00Z"))
        // Mietwagen, Parkplatz, Station wie Hotel.
        for type in ["car_rental", "parking", "stop"] {
            let span = itemJSON("s", type: type, start: "2027-05-08T10:00", end: "2027-05-12T10:00", endTz: "Europe/Zurich")
            #expect(NowLogic.entryEnd(try entry(span, id: "s"), defaultTz: "Europe/Zurich") == utc("2027-05-08T08:00:00Z"))
        }
        // Zug ohne Ende: Abfahrt.
        let train = itemJSON("t1", type: "train", start: "2027-05-08T08:00")
        #expect(NowLogic.entryEnd(try entry(train, id: "t1"), defaultTz: "Europe/Zurich") == utc("2027-05-08T06:00:00Z"))
        // Ausflug mit Ende ohne endTz: Ende in der Zone des Auftritts.
        let excursion = itemJSON("x1", type: "excursion", start: "2027-05-11T09:00", startTz: "Europe/Rome", end: "2027-05-11T13:00")
        #expect(NowLogic.entryEnd(try entry(excursion, id: "x1", tz: "Europe/Rome"), defaultTz: "Europe/Zurich") == utc("2027-05-11T11:00:00Z"))
        // Notiz nur mit Datum: Tagesende.
        let note = itemJSON("n1", type: "note", start: "2027-05-08")
        #expect(NowLogic.entryEnd(try entry(note, id: "n1"), defaultTz: "Europe/Zurich") == utc("2027-05-08T21:59:00Z"))
    }

    @Test func cruiseDayEnd() throws {
        let port = try JSONDecoder().decode(CruiseDay.self, from: Data("""
        {"id": "d1", "date": "2027-05-11", "kind": "port", "timezone": "Europe/Rome", "departure": "17:30"}
        """.utf8))
        #expect(NowLogic.dayEnd(port, defaultTz: "Europe/Zurich") == utc("2027-05-11T15:30:00Z"))
        let sea = try JSONDecoder().decode(CruiseDay.self, from: Data("""
        {"id": "d2", "date": "2027-05-12", "kind": "sea", "timezone": null, "departure": "17:30"}
        """.utf8))
        #expect(NowLogic.dayEnd(sea, defaultTz: "Europe/Zurich") == utc("2027-05-12T21:59:00Z"))
    }

    // MARK: Position der Markierung

    private func sampleTimeline() throws -> Timeline {
        let flight = itemJSON("f1", type: "flight", start: "2027-05-08T09:40", end: "2027-05-08T11:25", endTz: "Europe/Madrid")
        let hotel = itemJSON("h1", type: "hotel", start: "2027-05-08T15:00", startTz: "Europe/Madrid", end: "2027-05-09T11:00",
                             endTz: "Europe/Madrid")
        let json = """
        {"tripId": "t1", "defaultTimezone": "Europe/Zurich", "warnings": [], "phases": [
          {"kind": "pre", "title": "Anreise", "days": [
            {"date": "2027-05-08", "cruiseDay": null, "entries": [
              {"itemId": "f1", "role": "start", "time": "09:40", "timezone": "Europe/Zurich", "item": \(flight)},
              {"itemId": "h1", "role": "start", "time": "15:00", "timezone": "Europe/Madrid", "item": \(hotel)}]},
            {"date": "2027-05-09", "cruiseDay": null, "entries": [
              {"itemId": "h1", "role": "end", "time": "11:00", "timezone": "Europe/Madrid", "item": \(hotel)}]}]},
          {"kind": "cruise", "title": "Kreuzfahrt", "days": [
            {"date": "2027-05-09", "entries": [], "cruiseDay": {"id": "d1", "date": "2027-05-09", "kind": "embarkation",
              "timezone": "Europe/Madrid", "departure": "18:00"}}]}
        ]}
        """
        return try JSONDecoder().decode(Timeline.self, from: Data(json.utf8))
    }

    @Test func markerPosition() throws {
        let t = try sampleTimeline()
        // Vor der Reise: keine Markierung.
        #expect(NowLogic.nowElement(t, now: utc("2027-05-07T12:00:00Z")) == nil)
        // Im Flug (Landung 11:25 Madrid = 09:25 UTC): noch nichts vorbei → keine Markierung.
        #expect(NowLogic.nowElement(t, now: utc("2027-05-08T08:00:00Z")) == nil)
        // Nach der Landung, vor dem Check-in: Markierung vor dem Hotel, Uhrzeit in Madrid.
        let mid = NowLogic.nowElement(t, now: utc("2027-05-08T10:00:00Z"))
        #expect(mid?.key == "h1-start")
        #expect(mid?.timezone == "Europe/Madrid")
        // Nach dem Check-out, vor der Abfahrt: Markierung vor dem Einschiffungstag.
        #expect(NowLogic.nowElement(t, now: utc("2027-05-09T12:00:00Z"))?.key == "p:d1")
        // Nach der Reise: keine Markierung.
        #expect(NowLogic.nowElement(t, now: utc("2027-05-10T12:00:00Z")) == nil)
    }

    @Test func clockInZone() {
        #expect(NowLogic.clock(utc("2027-05-08T12:32:00Z"), tz: "Europe/Madrid") == "14:32")
        #expect(NowLogic.clock(utc("2027-05-08T12:32:00Z"), tz: "America/New_York") == "08:32")
    }

    // MARK: Reisetag-Abfrage: Vorauswahl und Körper von „Übernehmen“

    @Test func placeLookupPatchKeepsAllDetails() throws {
        let item = try JSONDecoder().decode(Item.self, from: Data(itemJSON("f1", type: "flight", start: "2027-05-08T09:40",
            details: #"{"gate": "B14", "flightNumber": "LX 1726", "seat": "14A", "pieces": 2, "nix": null}"#).utf8))
        let findings = try JSONDecoder().decode([PlaceLookupFinding].self, from: Data("""
        [{"key": "gate", "label": "Gate", "value": "B12", "current": "B14", "source": {"title": "ZRH", "url": "https://example.com"}, "note": null},
         {"key": "terminal", "label": "Terminal", "value": "1", "current": null, "source": null, "note": "laut Abflugtafel"},
         {"key": "checkinDesk", "label": "Schalter", "value": "31–40", "current": "31–40", "source": null, "note": null}]
        """.utf8))
        let selected = PlaceLookupSection.preselection(findings)
        #expect(selected == ["gate", "terminal"])
        let merged = PlaceLookupSection.mergedDetails(item.details?.raw ?? [:], findings: findings, selected: selected)
        #expect(merged["gate"] == .string("B12"))
        #expect(merged["terminal"] == .string("1"))
        #expect(merged["checkinDesk"] == nil)
        #expect(merged["flightNumber"] == .string("LX 1726"))
        #expect(merged["seat"] == .string("14A"))
        #expect(merged["pieces"] == .number(2))
        #expect(merged.keys.contains("nix"))
        // Körper wie gesendet: Zahl bleibt Zahl, null bleibt null.
        let body = try JSONEncoder().encode(["details": merged])
        let back = try JSONSerialization.jsonObject(with: body) as? [String: [String: Any]]
        #expect(back?["details"]?["pieces"] as? Int == 2)
        #expect(back?["details"]?["nix"] is NSNull)
    }

    // MARK: Zwischenspeicher

    @Test func cacheSaveLoadPruneClear() {
        let date = utc("2027-11-27T13:32:00Z")
        ResponseCache.save(Data("[]".utf8), as: ResponseCache.tripsFile, at: date)
        ResponseCache.save(Data("{}".utf8), as: ResponseCache.timelineFile("a"), at: date)
        ResponseCache.save(Data("{}".utf8), as: ResponseCache.timelineFile("b"), at: date)
        #expect(ResponseCache.load(ResponseCache.tripsFile)?.savedAt == date)
        ResponseCache.pruneTimelines(keeping: ["a"])
        #expect(ResponseCache.fileNames() == ["timeline-a.json", "trips.json"])
        let backup = try? ResponseCache.directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
        #expect(backup == true)
        ResponseCache.clear()
        #expect(ResponseCache.fileNames().isEmpty)
    }
}
