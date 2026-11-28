//
//  EditLogicTests.swift
//  ReisebuchTests
//
//  Auftrag 0.6.0: details zusammenführen, nur geänderte Felder, Zeit als Ortszeit-Text, Preis/Anzahlung, Ansichtsmodus, Arten.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct EditLogicTests {

    @Test func detailsMergeKeepsUnknownAndRemovesEmpty() {
        let original: [String: JSONValue] = [
            "gate": .string("B14"), "terminal": .string("1"), "pnr": .string("XYZ"), "legs": .number(2),
            "paymentStatus": .string("paid"), "seat": .string("12A"),
        ]
        let form = ["gate": "B12", "terminal": "1", "seat": "  ", "from": "ZRH"]
        let merged = EditMerge.details(original: original, form: form, knownKeys: ItemKinds.formKeys("flight"))
        #expect(merged["gate"] == .string("B12"))         // geändert
        #expect(merged["terminal"] == .string("1"))       // unverändert
        #expect(merged["seat"] == nil)                    // leer → entfernt
        #expect(merged["from"] == .string("ZRH"))         // neu
        #expect(merged["pnr"] == .string("XYZ"))          // unbekannt → bleibt
        #expect(merged["legs"] == .number(2))             // unbekannt, Zahl → bleibt
        #expect(merged["paymentStatus"] == .string("paid"))
        // Zahl, deren Text unverändert ist, bleibt Zahl
        let n = EditMerge.details(original: ["guests": .number(4)], form: ["guests": "4"], knownKeys: ["guests"])
        #expect(n["guests"] == .number(4))
    }

    @Test func patchOnlyChangedFields() throws {
        let item = try JSONDecoder().decode(Item.self, from: Data("""
        {"id": "i1", "type": "flight", "title": "Zürich → Rom", "startLocal": "2027-05-08T09:40", "startTz": "Europe/Zurich",
         "endLocal": "2027-05-08T11:15", "endTz": "Europe/Rome", "location": null, "provider": "SWISS", "confirmation": "K7XQ2P",
         "cost": 189, "currency": "CHF", "paymentStatus": null, "paidAmount": null, "dueDate": null, "notes": null,
         "cruiseDayId": null, "details": {"gate": "B14", "pnr": "XYZ"}, "infos": []}
        """.utf8))
        var new = EditMerge.payload(of: item)
        #expect(EditMerge.changed(original: EditMerge.payload(of: item), new: new).isEmpty)
        new["title"] = .string("Zürich → Rom (neu)")
        new["details"] = .object(EditMerge.details(original: item.details!.raw, form: ["gate": "B12"],
                                                   knownKeys: ItemKinds.formKeys("flight")))
        let changed = EditMerge.changed(original: EditMerge.payload(of: item), new: new)
        #expect(Set(changed.keys) == ["title", "details"])
        // details komplett, auch der unbekannte Schlüssel
        #expect(changed["details"] == .object(["gate": .string("B12"), "pnr": .string("XYZ")]))
    }

    @Test func localTimeAsText() {
        #expect(LocalTime.join(date: "2027-05-08", time: "09:40") == "2027-05-08T09:40")
        #expect(LocalTime.join(date: "2027-05-08", time: nil) == "2027-05-08")
        #expect(LocalTime.join(date: nil, time: "09:40") == nil)
        #expect(LocalTime.split("2027-05-08T09:40").date == "2027-05-08")
        #expect(LocalTime.split("2027-05-08T09:40").time == "09:40")
        #expect(LocalTime.split("2027-05-08").time == nil)
        // Hin und zurück über DatePicker-Werte, ohne Verschiebung durch Zeitzonen
        let d = LocalTime.date(from: "2027-03-28")!
        #expect(LocalTime.text(fromDate: d) == "2027-03-28")
        #expect(LocalTime.text(fromTime: LocalTime.time(from: "23:05")!) == "23:05")
        #expect(LocalTime.addDays("2027-02-28", 1) == "2027-03-01")
    }

    @Test func moneyDepositOnlyWithDeposit() {
        let paid = MoneyInput.build(cost: "1'250,50", currency: "eur", status: "paid", paid: "100", due: "2027-04-01")
        #expect(paid.value == MoneyInput.Value(cost: 1250.5, currency: "EUR", paymentStatus: "paid", paidAmount: nil, dueDate: nil))
        let deposit = MoneyInput.build(cost: "500", currency: "CHF", status: "deposit", paid: "100", due: "2027-04-01")
        #expect(deposit.value?.paidAmount == 100)
        #expect(deposit.value?.dueDate == "2027-04-01")
        let open = MoneyInput.build(cost: "500", currency: "", status: "open", paid: "100", due: nil)
        #expect(open.value?.paidAmount == nil && open.value?.currency == nil)
        // ohne Preis alles leer, keine Annahme „CHF“
        #expect(MoneyInput.build(cost: "", currency: "CHF", status: "deposit", paid: "100", due: "2027-04-01").value == MoneyInput.none)
        #expect(MoneyInput.build(cost: "abc", currency: "", status: "", paid: "", due: nil).error != nil)
        #expect(MoneyInput.build(cost: "10", currency: "EURO", status: "", paid: "", due: nil).error != nil)
        #expect(MoneyInput.build(cost: "10", currency: "", status: "deposit", paid: "x", due: nil).error != nil)
    }

    @Test func viewModeRule() throws {
        #expect(ViewMode.locked(isEditor: true, started: true, unlocked: false))
        #expect(!ViewMode.locked(isEditor: true, started: true, unlocked: true))
        #expect(!ViewMode.locked(isEditor: true, started: false, unlocked: false))
        #expect(!ViewMode.locked(isEditor: false, started: true, unlocked: false))
        #expect(ViewMode.isEditor("owner") && ViewMode.isEditor("editor") && !ViewMode.isEditor("viewer") && !ViewMode.isEditor(nil))

        let t = try JSONDecoder().decode(Timeline.self, from: Data("""
        {"tripId": "t1", "defaultTimezone": "Europe/Zurich", "warnings": [], "phases": [{"kind": "trip", "title": "R", "days": [
          {"date": "2027-05-08", "cruiseDay": null, "entries": [{"itemId": "a", "role": "start", "time": "09:40", "timezone": "Europe/Zurich",
            "item": {"id": "a", "type": "flight", "title": "F", "startLocal": "2027-05-08T09:40", "startTz": "Europe/Zurich"}}]}]}]}
        """.utf8))
        let f = ISO8601DateFormatter()
        #expect(!ViewMode.started(t, now: f.date(from: "2027-05-08T07:39:00Z")!))
        #expect(ViewMode.started(t, now: f.date(from: "2027-05-08T07:40:00Z")!))
    }

    @Test func availableKinds() {
        let cruise = ItemKinds.available(tripKind: "cruise", hasCruises: false)
        #expect(cruise.contains("excursion") && !cruise.contains("stop"))
        let city = ItemKinds.available(tripKind: "city", hasCruises: false)
        #expect(!city.contains("excursion") && city.contains("stop"))
        let cityWithCruise = ItemKinds.available(tripKind: "city", hasCruises: true)
        #expect(cityWithCruise.contains("excursion") && !cityWithCruise.contains("stop"))
        #expect(ItemKinds.formKeys("excursion") == ["meetingPoint", "bookedVia"])
    }
}

// ENDE EditLogicTests.swift
