//
//  SettingsLogicTests.swift
//  ReisebuchTests
//
//  Auftrag 0.9.0: Reiter, Kosten, Rechte im Reiter Teilen, Admin-Bereiche, Zeitbedarf, Passwort-Vorschlag, Einladung, PATCH-Bodies,
//  Route beim Anlegen einer Kreuzfahrt.
//

import Foundation
import Testing
@testable import Reisebuch

@MainActor
struct SettingsLogicTests {

    @Test func tabsVisibility() {
        #expect(TripTab.visible(kind: "cruise", hasCruises: false) == [.timeline, .cruise, .costs, .docs, .share])
        #expect(TripTab.visible(kind: "city", hasCruises: false) == [.timeline, .costs, .docs, .share])
        #expect(TripTab.visible(kind: "roundtrip", hasCruises: true).contains(.cruise))
    }

    @Test func costsPerCurrencyAndOverdue() throws {
        let json = """
        {"currencies": [
           {"currency": "EUR", "total": 3900, "paid": 920, "open": 2980, "unstated": 0,
            "groups": [{"kind": "cruise", "count": 1, "total": 3480, "paid": 500, "open": 2980, "entryIds": ["c1"]}]},
           {"currency": "CHF", "total": 189, "paid": 189, "open": 0, "unstated": 1,
            "groups": [{"kind": "flight", "count": 1, "total": 189, "paid": 189, "open": 0, "entryIds": ["i1"]}]}],
         "withoutCurrency": [], "missingPrice": [{"kind": "hotel", "count": 1, "entryIds": ["i2"]}],
         "due": [{"id": "c1", "source": "cruise", "kind": "cruise", "title": "MS Beispiel", "date": "2027-05-08", "cost": 3480,
                  "currency": "EUR", "paymentStatus": "deposit", "paid": 500, "open": 2980, "dueDate": "2027-03-01"}],
         "entries": []}
        """
        let c = try JSONDecoder().decode(TripCosts.self, from: Data(json.utf8))
        // Je Währung getrennt, nichts zusammengezählt
        #expect(c.currencies.map(\.currency) == ["EUR", "CHF"])
        #expect(c.currencies.map(\.total) == [3900, 189])
        #expect(CostLogic.isOverdue("2027-03-01", today: "2027-03-02"))
        #expect(!CostLogic.isOverdue("2027-03-01", today: "2027-03-01"))
        #expect(!CostLogic.isOverdue(nil, today: "2027-03-01"))
        #expect(CostLogic.dueText("2027-03-01", today: "2027-03-02").hasPrefix("überfällig seit "))
        #expect(CostLogic.dueText("2027-03-01", today: "2027-02-01").hasPrefix("bis "))
        #expect(CostLogic.kindLabel("cruise", count: 2).label == "Kreuzfahrten")
        #expect(CostLogic.paymentText(c.due[0]).hasPrefix("angezahlt"))
    }

    private func member(_ id: String, _ role: String) -> Member {
        Member(userId: id, username: id, displayName: id.uppercased(), role: role)
    }

    @Test func shareRights() {
        let one = [member("a", "owner"), member("b", "editor"), member("c", "viewer")]
        #expect(ShareRights.canManage(myRole: "owner", member: one[1], myId: "a"))
        #expect(!ShareRights.canManage(myRole: "owner", member: one[0], myId: "a"))       // nicht sich selbst
        #expect(!ShareRights.canManage(myRole: "editor", member: one[2], myId: "b"))
        #expect(ShareRights.canAdd(myRole: "owner") && !ShareRights.canAdd(myRole: "editor"))
        #expect(!ShareRights.canLeave(myRole: "owner", members: one))                      // letzter Besitzer
        #expect(ShareRights.canLeave(myRole: "editor", members: one))
        #expect(ShareRights.canLeave(myRole: "viewer", members: one))
        let two = one + [member("d", "owner")]
        #expect(ShareRights.canLeave(myRole: "owner", members: two))
        let users = [User(id: "a", username: "a", displayName: "A", isAdmin: true), User(id: "x", username: "x", displayName: "X", isAdmin: false)]
        #expect(ShareRights.candidates(users: users, members: one).map(\.id) == ["x"])
        #expect(ShareRights.label("viewer") == "Nur ansehen")
    }

    @Test func adminSections() {
        #expect(SettingsSection.visible(isAdmin: false) == [.account, .pace, .reminders, .device, .ai, .about])
        #expect(SettingsSection.visible(isAdmin: true).contains(.family))
        #expect(SettingsSection.pace.title == "Zeitbedarf")
    }

    @Test func paceExample() {
        let on = UserPace(enabled: true, factor: 1.5, extraMinutes: 0)
        #expect(PaceLogic.personal(30, on) == 45)
        #expect(PaceLogic.example(on) == "45 min")
        // 30 × 1,25 + 5 = 42,5 → auf 5 min aufgerundet 45
        #expect(PaceLogic.personal(30, UserPace(enabled: true, factor: 1.25, extraMinutes: 5)) == 45)
        #expect(PaceLogic.personal(60, UserPace(enabled: true, factor: 1.75, extraMinutes: 0)) == 105)
        let off = UserPace(enabled: false, factor: 2, extraMinutes: 30)
        #expect(PaceLogic.personal(30, off) == 30)
        #expect(PaceLogic.example(off) == "30 min (aus)")
        #expect(PaceLogic.factorText(1.5) == "× 1,5" && PaceLogic.factorText(2) == "× 2")
        #expect(PaceLogic.factorChoices(1.3).contains(1.3))
        #expect(PaceLogic.body(on) == ["pace": .object(["enabled": .bool(true), "factor": .number(1.5), "extraMinutes": .number(0)])])
    }

    @Test func passwordSuggestion() {
        let allowed = Set(Invite.alphabet)
        for _ in 0..<50 {
            let pw = Invite.generatePassword()
            let groups = pw.split(separator: "-")
            #expect(pw.count == 14 && groups.count == 3 && groups.allSatisfy { $0.count == 4 })
            #expect(pw.replacingOccurrences(of: "-", with: "").allSatisfy { allowed.contains($0) })
        }
        #expect(!Invite.alphabet.contains("0") && !Invite.alphabet.contains("o") && !Invite.alphabet.contains("l") && !Invite.alphabet.contains("1"))
    }

    @Test func inviteText() {
        let with = Invite.text(displayName: "Anna", username: "anna", password: "k7mq-x2ap-r9tz", address: "http://172.16.10.1:8080")
        #expect(with.hasPrefix("Hallo Anna,\n\n"))
        #expect(with.contains("Adresse: http://172.16.10.1:8080\nBenutzername: anna\nStartpasswort: k7mq-x2ap-r9tz"))
        let without = Invite.text(displayName: "Anna", username: "anna", password: nil, address: "x")
        #expect(without.contains("Das Startpasswort bekommst du separat von mir.") && !without.contains("Startpasswort:"))
    }

    @Test func patchBodies() {
        #expect(ProfileBody.make(displayName: " Anna ", currentPassword: "", newPassword: "") == ["displayName": .string("Anna")])
        #expect(ProfileBody.make(displayName: "Anna", currentPassword: "alt", newPassword: "neu12345")
                == ["displayName": .string("Anna"), "currentPassword": .string("alt"), "newPassword": .string("neu12345")])
        #expect(ProfileBody.check(currentPassword: "", newPassword: "", repeated: "") == nil)
        #expect(ProfileBody.check(currentPassword: "", newPassword: "neu12345", repeated: "neu12345") != nil)
        #expect(ProfileBody.check(currentPassword: "alt", newPassword: "neu12345", repeated: "neu1234") != nil)
        #expect(ProfileBody.check(currentPassword: "alt", newPassword: "kurz", repeated: "kurz") != nil)
        #expect(ProfileBody.check(currentPassword: "alt", newPassword: "neu12345", repeated: "neu12345") == nil)
        #expect(ReminderLogic.body("boardingLead", .number(90)) == ["notifications": .object(["boardingLead": .number(90)])])
        #expect(ReminderLogic.leadText(120) == "2 h vorher" && ReminderLogic.leadText(45) == "45 min vorher")
    }

    @Test func cruiseRoute() {
        let r = CruiseRoute.days(from: "2027-05-08", to: "2027-05-11", fromPort: "Genua", toPort: "", fromTz: "Europe/Rome", toTz: "")
        #expect(r.error == nil && r.days.count == 4)
        guard case let .object(first) = r.days[0], case let .object(sea) = r.days[1], case let .object(last) = r.days[3] else {
            Issue.record("Form"); return
        }
        #expect(first["kind"] == .string("embarkation") && first["portName"] == .string("Genua"))
        #expect(sea["kind"] == .string("sea") && sea["date"] == .string("2027-05-09"))
        #expect(last["kind"] == .string("disembarkation") && last["timezone"] == .string("Europe/Rome"))
        #expect(CruiseRoute.days(from: "2027-05-08", to: "2027-05-08", fromPort: "", toPort: "", fromTz: "", toTz: "").error != nil)
        #expect(CruiseRoute.days(from: nil, to: nil, fromPort: "", toPort: "", fromTz: "", toTz: "").days.isEmpty)
    }
}

// ENDE SettingsLogicTests.swift
