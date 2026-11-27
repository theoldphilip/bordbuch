//
//  ReisebuchTests.swift
//  ReisebuchTests
//
//  Prüft Dekodieren (Aufbau wie docs/API.md), Formatierung und ob iOS http://172.16.10.1 zulässt.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct ReisebuchTests {

    private let timelineJSON = """
    {
      "tripId": "t1", "updatedAt": "2027-01-01T10:00:00Z", "defaultTimezone": "Europe/Zurich",
      "pace": {"enabled": true, "factor": 1.5, "extraMinutes": 0},
      "somethingNew": 42,
      "phases": [
        {"kind": "pre", "title": "Anreise", "cruiseId": null, "startDate": "2027-05-08", "endDate": "2027-05-08",
         "days": [{"date": "2027-05-08", "cruiseDay": null, "entries": [
           {"itemId": "i1", "role": "start", "time": "09:40", "timezone": "Europe/Zurich",
            "item": {"id": "i1", "tripId": "t1", "type": "flight", "title": "Zürich – Rom", "startLocal": "2027-05-08T09:40",
                     "startTz": "Europe/Zurich", "endLocal": "2027-05-08T11:25", "endTz": "Europe/Rome", "location": null,
                     "confirmation": "ABC123", "provider": "SWISS", "notes": null, "cruiseDayId": null,
                     "cost": 420.5, "currency": "EUR", "paymentStatus": "deposit", "paidAmount": 100, "dueDate": "2027-04-01",
                     "details": {"gate": "B12", "terminal": "1", "checkinDesk": "31–40", "flightNumber": "LX 1726", "odd": 5, "nix": null},
                     "infos": [{"label": "Hotline", "value": "+41 44 564 45 64", "kind": "phone", "source": "document"}],
                     "createdAt": "x", "updatedAt": "y"}}]}]},
        {"kind": "cruise", "title": "Kreuzfahrt · MS Aurora", "cruiseId": "c1", "startDate": null, "endDate": null,
         "days": [{"date": "2027-05-10", "entries": [], "cruiseDay": {"id": "d1", "cruiseId": "c1", "date": "2027-05-10",
           "kind": "port", "portName": "Neapel", "country": "Italien", "timezone": "Europe/Rome", "arrival": "08:00",
           "departure": "18:00", "allAboard": "17:30", "tender": true, "notes": null,
           "infos": [{"label": "Notruf", "value": "112", "kind": "emergency", "source": "ai"}]}}]}
      ],
      "warnings": [
        {"level": "warning", "code": "excursion_tight", "message": "Nur 15 min", "itemId": "i1", "role": "start", "key": "k1", "ack": null},
        {"level": "info", "code": "embark_same_day", "message": "Anreise am selben Tag", "key": "k2", "ack": {"by": "u1", "at": "2027-01-01"}},
        {"level": "brandneu", "message": "Unbekanntes Level", "key": "k3", "ack": null, "personal": true}
      ]
    }
    """

    @Test func timelineDecodes() throws {
        let t = try JSONDecoder().decode(Timeline.self, from: Data(timelineJSON.utf8))
        #expect(t.phases.count == 2)
        let item = try #require(t.phases[0].days[0].entries.first?.item)
        #expect(item.detailMap["gate"] == "B12")
        #expect(item.detailMap["odd"] == "5")
        #expect(item.detailMap["nix"] == nil)
        #expect(Labels.placeLine(item) == "Terminal 1 · Schalter 31–40 · Gate B12")
        #expect(t.phases[1].days[0].cruiseDay?.tender == true)
        #expect(t.warnings.filter { $0.ack == nil }.count == 2)
    }

    @Test func tripListDecodes() throws {
        let json = """
        [{"id": "t1", "title": "Mittelmeer", "kind": "cruise", "startDate": null, "endDate": null, "notes": null, "color": null,
          "createdAt": "x", "updatedAt": "y", "role": "owner", "effectiveStartDate": "2027-05-08",
          "effectiveEndDate": "2027-05-13", "ships": ["MS Aurora"], "memberCount": 3}]
        """
        let trips = try JSONDecoder().decode([TripSummary].self, from: Data(json.utf8))
        #expect(trips.first?.ships == ["MS Aurora"])
    }

    @Test func formatting() {
        #expect(Fmt.range("2027-05-08", "2027-05-13") == "8. Mai – 13. Mai 2027")
        #expect(Fmt.range("2027-12-30", "2028-01-02") == "30. Dezember 2027 – 2. Januar 2028")
        #expect(Fmt.range(nil, nil) == "Noch keine Daten")
        #expect(Fmt.dayHeader("2027-05-08") == "Sa., 8. Mai")
        #expect(Fmt.telURL("+41 44 564 45 64")?.absoluteString == "tel:+41445644564")
        #expect(Fmt.telURL("(0)44 / 123-45")?.absoluteString == "tel:04412345")
        #expect(APIClient.normalizedBaseURL(" 172.16.10.1:8080/ ")?.absoluteString == "http://172.16.10.1:8080")
    }

    /// Ein ATS-Block käme sofort mit -1022 (appTransportSecurityRequiresSecureConnection). Jeder andere Ausgang
    /// (Antwort, Zeitüberschreitung, nicht erreichbar) heißt: iOS lässt http:// zu dieser IP-Adresse zu.
    @Test func plainHTTPToHomeServerIsAllowed() async {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: config)
        do {
            _ = try await session.data(from: URL(string: "http://172.16.10.1:8080/api/version")!)
        } catch let error as URLError {
            #expect(error.code != .appTransportSecurityRequiresSecureConnection, "ATS blockiert: \(error)")
        } catch {}
    }
}
