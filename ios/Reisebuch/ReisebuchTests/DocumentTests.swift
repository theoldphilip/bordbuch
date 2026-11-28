//
//  DocumentTests.swift
//  ReisebuchTests
//
//  Auftrag 0.7.0: Vorbelegung übernehmen/überspringen, apply-Body, Status-Texte, documentId, Mehrteil-Body, Umzug des Tokens.
//

import Foundation
import Security
import Testing
@testable import Reisebuch

@MainActor
struct DocumentTests {

    private func analysis(_ json: String) throws -> AnalysisView {
        try JSONDecoder().decode(AnalysisView.self, from: Data(json.utf8))
    }

    private let sample = """
    {"status": "done", "documentKind": "Flugbestätigung", "summary": "Zwei Flüge", "warnings": [],
     "items": [
       {"index": 0, "confidence": "high", "match": null, "problems": [],
        "data": {"type": "flight", "title": "Zürich → Rom", "startLocal": "2027-05-08T09:40", "details": {"gate": "B12", "x": 1}}},
       {"index": 1, "confidence": "medium", "match": {"itemId": "i9", "title": "Rom → Zürich", "reason": "gleiche Buchung", "changes": ["Gate"]},
        "problems": [], "data": {"type": "flight", "title": "Rom → Zürich", "startLocal": "2027-05-15T18:00"}},
       {"index": 2, "confidence": "low", "match": null, "problems": [], "data": {"type": "note", "title": "Hinweis", "startLocal": "2027-05-08"}},
       {"index": 3, "confidence": "high", "match": null, "problems": ["Datum fehlt"], "data": {"type": "hotel", "title": "Hotel"}}
     ],
     "cruise": {"data": {"shipName": "MS Beispiel", "days": []}, "match": {"cruiseId": "c1", "shipName": "MS Beispiel", "reason": "x"},
                "newDays": 2, "updatedDays": 3, "problems": []}}
    """

    @Test func defaultsAndApplyBody() throws {
        let v = try analysis(sample)
        let items = try #require(v.items)
        #expect(items.map(DocReviewLogic.defaultApply) == [true, true, false, false])
        let cruise = try #require(v.cruise)
        #expect(DocReviewLogic.defaultApply(cruise))

        let body = DocReviewLogic.applyBody(items: items.map { (proposal: $0, apply: DocReviewLogic.defaultApply($0)) },
                                            cruise: (proposal: cruise, apply: true))
        guard case let .array(list)? = body["items"] else { Issue.record("items fehlt"); return }
        #expect(list.count == 4)
        guard case let .object(first) = list[0], case let .object(second) = list[1], case let .object(third) = list[2] else {
            Issue.record("Form"); return
        }
        #expect(first["action"] == .string("create") && first["itemId"] == nil)
        // data unverändert, auch unbekannte Schlüssel und Zahlen
        guard case let .object(data)? = first["data"], case let .object(details)? = data["details"] else { Issue.record("data"); return }
        #expect(details["x"] == .number(1) && details["gate"] == .string("B12"))
        #expect(second["action"] == .string("update") && second["itemId"] == .string("i9"))
        #expect(third["action"] == .string("skip"))
        guard case let .object(c)? = body["cruise"] else { Issue.record("cruise"); return }
        #expect(c["action"] == .string("update") && c["cruiseId"] == .string("c1"))

        let skipped = DocReviewLogic.applyBody(items: [], cruise: (proposal: cruise, apply: false))
        guard case let .object(cs)? = skipped["cruise"] else { Issue.record("cruise"); return }
        #expect(cs["action"] == .string("skip"))
        #expect(DocReviewLogic.applyBody(items: [], cruise: nil)["cruise"] == .null)
    }

    private func attachment(_ id: String, _ status: String?, created: String = "2027-01-01T10:00:00Z", error: String? = nil) -> Reisebuch.Attachment {
        Reisebuch.Attachment(id: id, tripId: "t1", itemId: nil, filename: "\(id).pdf", mime: "application/pdf", size: 10, createdAt: created,
                   analysisStatus: status, analysisError: error)
    }

    @Test func statusTexts() {
        #expect(DocumentStatus.text(attachment("a", "pending")) == "Wird gelesen …")
        #expect(DocumentStatus.text(attachment("a", "done")) == "Vorschläge prüfen")
        #expect(DocumentStatus.text(attachment("a", "failed", error: "Datei leer")) == "Nicht gelesen: Datei leer")
        #expect(DocumentStatus.text(attachment("a", "applied")) == "Übernommen")
        #expect(DocumentStatus.text(attachment("a", "dismissed")) == nil)
        #expect(DocumentStatus.text(attachment("a", nil)) == nil)
        let list = [attachment("alt", "done", created: "2027-01-01T10:00:00Z"), attachment("g", "grouped", created: "2027-03-01T10:00:00Z"),
                    attachment("neu", "pending", created: "2027-02-01T10:00:00Z")]
        #expect(DocumentStatus.visible(list).map(\.id) == ["neu", "alt"])
        #expect(DocumentStatus.anyPending(list))
    }

    @Test func documentIdFromUserInfo() {
        #expect(DocumentStatus.documentId(from: ["url": "/trips/t1", "documentId": "d7"]) == "d7")
        #expect(DocumentStatus.documentId(from: ["url": "/trips/t1"]) == nil)
        #expect(DocumentStatus.documentId(from: ["documentId": ""]) == nil)
        #expect(DocumentStatus.documentId(from: ["documentId": 5]) == nil)
    }

    @Test func multipartBody() throws {
        let src = FileManager.default.temporaryDirectory.appendingPathComponent("quelle-\(UUID().uuidString).pdf")
        try Data("%PDF-Inhalt".utf8).write(to: src)
        defer { try? FileManager.default.removeItem(at: src) }
        let out = try Upload.writeBody(from: src, filename: "Buchung \"Rom\".pdf", mime: Upload.mime(for: "x.pdf"), boundary: "B0")
        defer { try? FileManager.default.removeItem(at: out) }
        let text = String(decoding: try Data(contentsOf: out), as: UTF8.self)
        #expect(text == "--B0\r\nContent-Disposition: form-data; name=\"file\"; filename=\"Buchung 'Rom'.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-Inhalt\r\n--B0--\r\n")
        #expect(Upload.mime(for: "Foto.jpg") == "image/jpeg")
        #expect(Upload.mime(for: "Text.txt") == "text/plain")
        #expect(Upload.mime(for: "mail.eml") == "message/rfc822")
        #expect(Upload.outcome(status: 202, response: nil) == .background)
        #expect(Upload.outcome(status: 201, response: nil) == .saved)
    }

    /// Schlüsselbund im Speicher.
    final class FakeKeychain: KeychainBackend {
        var entries: [(group: String?, data: Data)] = []
        var addStatus: OSStatus = errSecSuccess
        func items() -> [(group: String?, data: Data)] { entries }
        func add(_ data: Data, group: String?) -> OSStatus {
            guard addStatus == errSecSuccess || group == nil else { return addStatus }
            entries.append((group ?? "TEAM.de.theoldphilip.Reisebuch", data))
            return errSecSuccess
        }
        func delete(group: String?) { entries.removeAll { group == nil || $0.group == group } }
    }

    @Test func tokenMigration() {
        let token = Data("tok".utf8)
        let old = "TEAM.de.theoldphilip.Reisebuch"
        // alter Eintrag → in die Gruppe, alter gelöscht
        let k = FakeKeychain()
        k.entries = [(old, token)]
        #expect(Keychain.migrate(k) == .moved)
        #expect(k.entries.count == 1 && k.entries[0].group == Keychain.group)
        #expect(Keychain.readToken(k) == "tok")
        // zweiter Start: nichts mehr zu tun
        #expect(Keychain.migrate(k) == .alreadyInGroup)
        // nichts gespeichert
        #expect(Keychain.migrate(FakeKeychain()) == .nothing)
        // Berechtigung fehlt: alter Eintrag bleibt und gilt weiter
        let missing = FakeKeychain()
        missing.entries = [(old, token)]
        missing.addStatus = Keychain.missingEntitlement
        #expect(Keychain.migrate(missing) == .missingEntitlement)
        #expect(missing.entries.count == 1 && missing.entries[0].group == old)
        #expect(Keychain.readToken(missing) == "tok")
        // Speichern ohne Berechtigung: Ersatz in der App-Gruppe
        #expect(Keychain.saveToken("neu", missing))
        #expect(Keychain.readToken(missing) == "neu")
        // Abmelden löscht überall
        Keychain.deleteToken(k)
        #expect(Keychain.readToken(k) == nil)
    }
}

// ENDE DocumentTests.swift
