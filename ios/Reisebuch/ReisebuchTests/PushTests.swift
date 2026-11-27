//
//  PushTests.swift
//  ReisebuchTests
//
//  Auftrag 0.4.0: Hex-Text des Geräte-Tokens, Reise aus der url einer Nachricht, Text der Testnachricht.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct PushTests {

    @Test func hexTokenIsLowercaseHex() {
        let data = Data([0x00, 0x0f, 0xab, 0xCD, 0xff, 0x10])
        #expect(PushLogic.hexToken(data) == "000fabcdff10")
        let token = Data((0..<32).map { UInt8($0 * 7 % 256) })
        let hex = PushLogic.hexToken(token)
        #expect(hex.count == 64)
        #expect(hex == hex.lowercased())
        #expect(PushLogic.hexToken(Data()) == "")
    }

    @Test func tripIdFromURL() {
        #expect(PushLogic.tripId(fromPath: "/trips/abc") == "abc")
        #expect(PushLogic.tripId(fromPath: "/trips/7f3e-11") == "7f3e-11")
        #expect(PushLogic.tripId(fromPath: "/") == nil)
        #expect(PushLogic.tripId(fromPath: "") == nil)
        #expect(PushLogic.tripId(fromPath: nil) == nil)
        #expect(PushLogic.tripId(fromPath: "/trips/") == nil)
        #expect(PushLogic.tripId(fromPath: "/trips") == nil)
        #expect(PushLogic.tripId(fromPath: "trips/abc") == nil)
        #expect(PushLogic.tripId(fromPath: "/trips/abc/items") == nil)
        #expect(PushLogic.tripId(fromPath: "/items/abc") == nil)
        #expect(PushLogic.tripId(fromPath: "https://example.com/trips/abc") == nil)
    }

    @Test func tapUsesWidgetPath() {
        let session = AppSession()
        let push = PushController(session: session)
        push.open(path: "/trips/abc")
        #expect(session.pendingTripId == "abc")
        session.pendingTripId = nil
        push.open(path: "/")
        #expect(session.pendingTripId == nil)
        #expect(PushLogic.appURL(forTripId: "abc")?.absoluteString == "reisebuch://trip/abc")
    }

    @Test func testResultText() throws {
        func results(_ json: String) throws -> [PushTestResponse.Result] {
            try JSONDecoder().decode(PushTestResponse.self, from: Data(json.utf8)).results
        }
        #expect(PushLogic.testText(try results(#"{"results": [{"deviceName": "iPhone-App", "kind": "app", "ok": true, "error": null}]}"#))
                == "Gesendet, sollte gleich ankommen.")
        #expect(PushLogic.testText(try results(#"""
        {"results": [{"deviceName": "iPhone-App", "kind": "app", "ok": false, "error": "HTTP 410 Unregistered"},
                     {"deviceName": null, "kind": "web", "ok": true, "error": null}]}
        """#)) == "iPhone-App: HTTP 410 Unregistered\nBrowser: ok")
        #expect(PushLogic.testText([]) == "Kein Gerät angemeldet.")
    }
}

// ENDE PushTests.swift
