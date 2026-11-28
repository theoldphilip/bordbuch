//
//  PlaceReminderTests.swift
//  ReisebuchTests
//
//  Auftrag 0.5.0: Auswahl der Orte für Erinnerungen am Ort (Suchtext, Text, Zeitfenster, Grenze 20, Kennungen).
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct PlaceReminderTests {

    private func utc(_ text: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: text)!
    }

    private func trip(_ id: String = "t1", ships: [String] = []) throws -> TripSummary {
        let shipsJSON = ships.map { "\"\($0)\"" }.joined(separator: ",")
        return try JSONDecoder().decode(TripSummary.self, from: Data("""
        {"id": "\(id)", "title": "Testreise", "kind": "cruise", "startDate": null, "endDate": null,
         "effectiveStartDate": null, "effectiveEndDate": null, "ships": [\(shipsJSON)]}
        """.utf8))
    }

    private func item(_ id: String, type: String, title: String = "Titel", start: String, location: String? = nil,
                      provider: String? = nil, confirmation: String? = nil, details: String = "{}") -> String {
        func q(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
        {"id": "\(id)", "type": "\(type)", "title": "\(title)", "startLocal": "\(start)", "startTz": "Europe/Zurich",
         "endLocal": null, "endTz": null, "location": \(q(location)), "provider": \(q(provider)),
         "confirmation": \(q(confirmation)), "details": \(details), "infos": []}
        """
    }

    private func entry(_ itemJSON: String, id: String, role: String = "start") -> String {
        """
        {"itemId": "\(id)", "role": "\(role)", "time": null, "timezone": "Europe/Zurich", "item": \(itemJSON)}
        """
    }

    private func timeline(days: [String], phaseTitle: String = "Reise", cruiseId: String? = nil) throws -> Timeline {
        let cid = cruiseId.map { "\"\($0)\"" } ?? "null"
        return try JSONDecoder().decode(Timeline.self, from: Data("""
        {"tripId": "t1", "defaultTimezone": "Europe/Zurich", "warnings": [], "phases": [
          {"kind": "trip", "title": "\(phaseTitle)", "cruiseId": \(cid), "days": [\(days.joined(separator: ","))]}]}
        """.utf8))
    }

    private func day(_ date: String, entries: [String], cruiseDay: String = "null") -> String {
        """
        {"date": "\(date)", "cruiseDay": \(cruiseDay), "entries": [\(entries.joined(separator: ","))]}
        """
    }

    private func kandidaten(_ entries: [String], now: Date) throws -> [OrtKandidat] {
        let t = try timeline(days: [day("2027-05-08", entries: entries)])
        return OrtAuswahl.kandidaten([(trip: try trip(), timeline: t, detail: nil)], now: now)
    }

    // jetzt: 08.05.2027 06:00 Zürich (04:00 UTC)
    private var now: Date { utc("2027-05-08T04:00:00Z") }

    @Test func flightWithFromAndPlaceFields() throws {
        let flight = item("f1", type: "flight", title: "Zürich → Rom", start: "2027-05-08T09:40",
                          details: #"{"from": "zrh", "to": "FCO", "terminal": "2", "checkinDesk": "3", "gate": "B12", "baggageBelt": "7", "pnr": "XYZ"}"#)
        let k = try #require(try kandidaten([entry(flight, id: "f1")], now: now).first)
        #expect(k.id == "ort-f1")
        #expect(k.tripId == "t1")
        #expect(k.titel == "✈️ Zürich → Rom")
        #expect(k.text == "Abflug 09:40 · Terminal 2 · Schalter 3 · Gate B12")
        #expect(k.suche.first == OrtSuchtext(art: .flughafen, text: "ZRH Airport"))
        #expect(k.radius == 2000)
        #expect(k.zeit == utc("2027-05-08T07:40:00Z"))
    }

    @Test func flightWithoutPlaceFieldsOnlyTime() throws {
        let flight = item("f2", type: "flight", title: "Flug", start: "2027-05-08T09:40", location: "Flughafen Zürich")
        let k = try #require(try kandidaten([entry(flight, id: "f2")], now: now).first)
        #expect(k.text == "Abflug 09:40")
        #expect(k.suche == [OrtSuchtext(art: .ort, text: "Flughafen Zürich")])
        // ohne Ort: Kandidat ohne Suchtext (erscheint in der Liste als „Kein Ort eingetragen“)
        let leer = item("f3", type: "flight", start: "2027-05-08T09:40")
        #expect(try kandidaten([entry(leer, id: "f3")], now: now).first?.suche.isEmpty == true)
    }

    @Test func trainCarAndOtherTypes() throws {
        let train = item("z1", type: "train", title: "Bern → Zürich", start: "2027-05-08T08:02",
                         details: #"{"from": "Bern", "platform": "7", "seat": "12/45"}"#)
        let car = item("c1", type: "car_rental", title: "Mietwagen", start: "2027-05-08T12:00", location: "Via Roma 1, Rom",
                       provider: "Beispiel Autos", confirmation: "AB12", details: #"{"desk": "4"}"#)
        let note = item("n1", type: "note", start: "2027-05-08T10:00", location: "Irgendwo")
        let all = try kandidaten([entry(train, id: "z1"), entry(car, id: "c1"), entry(note, id: "n1")], now: now)
        #expect(all.map(\.id) == ["ort-z1", "ort-c1"])
        #expect(all[0].text == "Abfahrt 08:02 · Gleis 7 · Wagen/Platz 12/45")
        #expect(all[0].suche.first == OrtSuchtext(art: .bahnhof, text: "Bern"))
        #expect(all[0].radius == 400)
        #expect(all[1].text == "Abholung 12:00 · Schalter 4 · Beispiel Autos · Buchung AB12")
        #expect(all[1].suche.first == OrtSuchtext(art: .adresse, text: "Via Roma 1, Rom"))
        #expect(all[1].radius == 300)
    }

    @Test func window36Hours() throws {
        // jetzt 04:00 UTC; 35 h → 09.05. 15:00 UTC = 17:00 Zürich, 37 h → 19:00 Zürich, vorbei → 05:00 Zürich am 08.05.
        let in35 = item("a", type: "flight", start: "2027-05-09T17:00", location: "X")
        let in37 = item("b", type: "flight", start: "2027-05-09T19:00", location: "X")
        let past = item("c", type: "flight", start: "2027-05-08T05:00", location: "X")
        let t = try timeline(days: [day("2027-05-08", entries: [entry(past, id: "c")]),
                                    day("2027-05-09", entries: [entry(in35, id: "a"), entry(in37, id: "b")])])
        let ids = OrtAuswahl.kandidaten([(trip: try trip(), timeline: t, detail: nil)], now: now).map(\.id)
        #expect(ids == ["ort-a"])
    }

    @Test func hotelWindow() throws {
        let hotel = item("h1", type: "hotel", title: "Hotel Beispiel", start: "2027-05-09T21:00", location: "Rua Exemplo 1",
                         confirmation: "H1", details: #"{"room": "12"}"#)
        // Check-in 09.05. 21:00 Zürich = 19:00 UTC, 39 h nach jetzt: Fenster beginnt 6 h vorher (33 h) → geplant
        let k = try #require(try kandidaten([entry(hotel, id: "h1")], now: now).first)
        #expect(k.text == "Check-in ab 21:00 · Zimmer 12 · Buchung H1")
        #expect(k.radius == 200)
        #expect(k.ab == utc("2027-05-09T13:00:00Z") && k.bis == utc("2027-05-10T07:00:00Z"))
        // 43 h nach jetzt: Fenster beginnt nach 37 h → nicht
        let spaet = item("h2", type: "hotel", start: "2027-05-10T01:00", location: "X")
        #expect(try kandidaten([entry(spaet, id: "h2")], now: now).isEmpty)
        // Check-in vor 11 h → noch im Fenster (bis 12 h danach), vor 13 h → nicht mehr
        let vor11 = item("h3", type: "hotel", start: "2027-05-07T19:00", location: "X")
        let vor13 = item("h4", type: "hotel", start: "2027-05-07T17:00", location: "X")
        #expect(try kandidaten([entry(vor11, id: "h3"), entry(vor13, id: "h4")], now: now).map(\.id) == ["ort-h3"])
        // Check-out (role end) erzeugt keinen zweiten Ort
        #expect(try kandidaten([entry(hotel, id: "h1"), entry(hotel, id: "h1", role: "end")], now: now).count == 1)
    }

    @Test func embarkationDay() throws {
        let cd = """
        {"id": "d1", "cruiseId": "c1", "date": "2027-05-08", "kind": "embarkation", "portName": "Genua", "country": "Italien",
         "timezone": "Europe/Rome", "departure": "18:00", "allAboard": "17:00"}
        """
        let t = try timeline(days: [day("2027-05-08", entries: [], cruiseDay: cd)], phaseTitle: "Kreuzfahrt · MS Titel", cruiseId: "c1")
        let detail = try JSONDecoder().decode(TripDetail.self, from: Data("""
        {"role": "owner", "cruises": [{"id": "c1", "shipName": "MS Beispiel", "cabin": "8123"}]}
        """.utf8))
        let k = try #require(OrtAuswahl.kandidaten([(trip: try trip(), timeline: t, detail: detail)], now: now).first)
        #expect(k.id == "ort-day-d1")
        #expect(k.titel == "🚢 MS Beispiel")
        #expect(k.text == "Einschiffung · Kabine 8123 · Alle an Bord 17:00")
        #expect(k.suche.first == OrtSuchtext(art: .ort, text: "Cruise Terminal Genua, Italien"))
        #expect(k.radius == 1500)
        #expect(k.bis == utc("2027-05-08T15:00:00Z"))
        // ohne Detail: Schiff aus dem Titel des Abschnitts, ohne Kabine
        let ohne = try #require(OrtAuswahl.kandidaten([(trip: try trip(), timeline: t, detail: nil)], now: now).first)
        #expect(ohne.titel == "🚢 MS Titel")
        #expect(ohne.text == "Einschiffung · Alle an Bord 17:00")
        // nach „Alle an Bord“ vorbei
        #expect(OrtAuswahl.kandidaten([(trip: try trip(), timeline: t, detail: nil)], now: utc("2027-05-08T15:01:00Z")).isEmpty)
    }

    @Test func atMost20Earliest() throws {
        let entries = (0..<25).map { i in
            entry(item("z\(i)", type: "train", start: String(format: "2027-05-08T%02d:%02d", 8 + i / 4, (i % 4) * 15), location: "X"),
                  id: "z\(i)")
        }
        let all = try kandidaten(entries.reversed(), now: now)
        #expect(all.count == 25)
        #expect(all.map(\.zeit) == all.map(\.zeit).sorted())
        let plan = OrtAuswahl.zumPlanen(all, gefunden: Set(all.map(\.id)))
        #expect(plan.count == 20)
        #expect(plan.first?.id == "ort-z0" && plan.last?.id == "ort-z19")
        // Nicht gefundene werden übersprungen, der nächste rückt nach
        let ohneErsten = OrtAuswahl.zumPlanen(all, gefunden: Set(all.map(\.id)).subtracting(["ort-z0"]))
        #expect(ohneErsten.first?.id == "ort-z1" && ohneErsten.last?.id == "ort-z20")
    }

    @Test func stableIds() throws {
        let flight = item("f1", type: "flight", start: "2027-05-08T09:40", location: "X")
        let a = try kandidaten([entry(flight, id: "f1")], now: now).map(\.id)
        let b = try kandidaten([entry(flight, id: "f1")], now: now.addingTimeInterval(600)).map(\.id)
        #expect(a == ["ort-f1"] && a == b)
        #expect(OrtAuswahl.uhrzeit("2027-05-08") == nil)
        #expect(OrtAuswahl.uhrzeit("2027-05-08T09:40") == "09:40")
    }
}

// ENDE PlaceReminderTests.swift
