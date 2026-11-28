//
//  AILogicTests.swift
//  ReisebuchTests
//
//  Auftrag 0.8.0: Sichtbarkeit der KI-Knöpfe, Funde, Polling, Vorschlag bearbeiten, Recherche-Bodies, Gruppen-Body, Reisename,
//  Bodies von PUT /ai/config.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct AILogicTests {

    @Test func featureVisibility() {
        let all = AIStatus(enabled: true, placeLookup: true, research: true, review: true)
        #expect(AIFeatures(status: all, role: "owner").canStartReview)
        #expect(AIFeatures(status: all, role: "editor").showResearch)
        let viewer = AIFeatures(status: all, role: "viewer")
        #expect(viewer.showReview && !viewer.canStartReview && !viewer.showResearch && !viewer.placeLookup)
        let off = AIFeatures(status: AIStatus(enabled: false, placeLookup: false, research: false, review: false), role: "owner")
        #expect(!off.showReview && !off.showResearch && !off.aiImport && !off.placeLookup)
        #expect(!AIFeatures(status: nil, role: "owner").showReview)
        #expect(AIFeatures(status: AIStatus(enabled: true), role: nil).aiImport)
    }

    private func finding(_ sev: String, _ title: String) -> ReviewFinding {
        ReviewFinding(severity: sev, title: title, text: nil, itemIds: nil, dayIds: nil, suggestion: nil)
    }

    @Test func findingsSortedAndColored() {
        let list = [finding("hint", "h1"), finding("error", "e1"), finding("warning", "w1"), finding("error", "e2"), finding("hint", "h2")]
        #expect(ReviewLogic.sorted(list).map(\.title) == ["e1", "e2", "w1", "h1", "h2"])
        #expect(ReviewLogic.colorName("error") == "red" && ReviewLogic.colorName("warning") == "orange" && ReviewLogic.colorName("hint") == "secondary")
        #expect(ReviewLogic.label("hint").label == "Hinweis")
        #expect(ReviewLogic.countText(list) == "2 Fehler · 1 Warnung · 2 Hinweise")
        #expect(ReviewLogic.countText([]) == "Keine Auffälligkeiten.")
    }

    @Test func pollingStops() {
        #expect(Polling.shouldContinue("pending"))
        #expect(!Polling.shouldContinue("done"))
        #expect(!Polling.shouldContinue("failed"))
        #expect(!Polling.shouldContinue(nil))
    }

    @Test func replaceProposalData() throws {
        let original: [String: JSONValue] = [
            "type": .string("flight"), "title": .string("Alt"), "startLocal": .string("2027-05-08T09:40"),
            "details": .object(["gate": .string("B14"), "pnr": .string("XYZ")]), "fremd": .number(3),
        ]
        // So, wie das Formular es liefert: details schon zusammengeführt (unbekannter Schlüssel bleibt)
        let item = try #require(ProposalEdit.item(from: original))
        #expect(item.title == "Alt" && item.detailMap["pnr"] == "XYZ")
        let merged = EditMerge.details(original: item.details?.raw ?? [:], form: ["gate": "B12"], knownKeys: ItemKinds.formKeys("flight"))
        let payload: [String: JSONValue] = ["title": .string("Neu"), "details": .object(merged)]
        let result = ProposalEdit.replaceData(original: original, payload: payload)
        #expect(result["title"] == .string("Neu"))
        #expect(result["startLocal"] == .string("2027-05-08T09:40"))
        #expect(result["fremd"] == .number(3))
        #expect(result["details"] == .object(["gate": .string("B12"), "pnr": .string("XYZ")]))
        // Vorschlag ohne Datum lässt sich trotzdem im Formular öffnen
        #expect(ProposalEdit.item(from: ["type": .string("hotel"), "title": .string("H")])?.startLocal == "")
    }

    @Test func researchBodies() {
        #expect(ResearchLogic.startBody(mode: "gaps", url: nil) == ["mode": .string("gaps"), "url": .null])
        #expect(ResearchLogic.startBody(mode: "route", url: "https://x.ch/a") == ["mode": .string("route"), "url": .string("https://x.ch/a")])
        #expect(ResearchLogic.acceptBody(["a", "b"]) == ["ids": .array([.string("a"), .string("b")])])
        #expect(ResearchLogic.validURL("  ").url == nil && ResearchLogic.validURL("  ").error == nil)
        #expect(ResearchLogic.validURL("https://reederei.example/reise").url == "https://reederei.example/reise")
        #expect(ResearchLogic.validURL("ftp://x").error != nil)
        #expect(ResearchLogic.validURL("reederei.example").error != nil)
    }

    @Test func groupBodyAndDefault() {
        #expect(Upload.groupBody(["a1", "a2"]) == ["attachmentIds": .array([.string("a1"), .string("a2")])])
        #expect(Upload.defaultGrouped(filenames: ["Foto-1.jpg", "Foto-2.PNG"]))
        #expect(!Upload.defaultGrouped(filenames: ["Foto-1.jpg", "Buchung.pdf"]))
        #expect(!Upload.defaultGrouped(filenames: ["Foto-1.jpg"]))
    }

    @Test func titleAdoption() {
        #expect(TripTitle.adopt(current: "Neue Reise", suggestion: "Mittelmeer Mai 2027") == "Mittelmeer Mai 2027")
        #expect(TripTitle.adopt(current: "Meine Reise", suggestion: "Mittelmeer Mai 2027") == nil)
        #expect(TripTitle.adopt(current: "Neue Reise", suggestion: nil) == nil)
        #expect(TripTitle.adopt(current: "Neue Reise", suggestion: "  ") == nil)
    }

    @Test func aiConfigBodies() {
        #expect(AIConfigBody.primary("openai") == ["primary": .string("openai")])
        #expect(AIConfigBody.fallback(false) == ["fallback": .bool(false)])
        #expect(AIConfigBody.key("gemini", "  abc ") == ["providers": .object(["gemini": .object(["key": .string("abc")])])])
        #expect(AIConfigBody.key("anthropic", nil) == ["providers": .object(["anthropic": .object(["key": .null])])])
        #expect(AIConfigBody.model("openai", "") == ["providers": .object(["openai": .object(["model": .null])])])
        #expect(AIConfigBody.model("openai", "gpt-x") == ["providers": .object(["openai": .object(["model": .string("gpt-x")])])])
    }
}

// ENDE AILogicTests.swift
