//
//  SettingsLogic.swift
//  Reisebuch
//
//  Reiter und Einstellungen wie in der Web-App (Auftrag 0.9.0), ohne Oberfläche: Reiter der Reise, Kosten (vom Server gerechnet, nie
//  umgerechnet), Rechte im Reiter „Teilen“, Bereiche der Einstellungen, Persönlicher Zeitbedarf (Beispielrechnung wie Pace.tsx),
//  Erinnerungen (Vorlauf wie Notifications.tsx), Passwort-Vorschlag und Einladungstext wie invite.ts, PATCH-Bodies. Dazu die Modelle
//  und Aufrufe (nur App). Getestet in SettingsLogicTests.
//

import Foundation

// MARK: - Reiter der Reise

enum TripTab: String, CaseIterable, Identifiable {
    case timeline, cruise, costs, docs, share
    var id: String { rawValue }

    var label: String {
        switch self {
        case .timeline: return "Ablauf"
        case .cruise: return "Kreuzfahrt"
        case .costs: return "Kosten"
        case .docs: return "Dokumente"
        case .share: return "Teilen"
        }
    }

    /// „Kreuzfahrt“ nur bei Reiseart Kreuzfahrt oder vorhandener Kreuzfahrt (wie Trip.tsx).
    static func visible(kind: String?, hasCruises: Bool) -> [TripTab] {
        allCases.filter { $0 != .cruise || kind == "cruise" || hasCruises }
    }
}

// MARK: - Kosten

nonisolated struct CostEntry: Decodable, Identifiable, Hashable {
    let id: String
    /// item oder cruise
    let source: String
    let kind: String
    let title: String
    let date: String?
    let cost: Double?
    let currency: String?
    let paymentStatus: String?
    let paid: Double?
    let open: Double?
    let dueDate: String?
}

nonisolated struct CostGroup: Decodable, Hashable {
    let kind: String
    let count: Int
    let total: Double?
    let paid: Double?
    let open: Double?
    let entryIds: [String]
}

nonisolated struct CurrencyTotal: Decodable, Hashable {
    let currency: String
    let total: Double
    let paid: Double
    let open: Double
    let unstated: Int?
    let groups: [CostGroup]
}

nonisolated struct MissingPrice: Decodable, Hashable {
    let kind: String
    let count: Int
    let entryIds: [String]
}

nonisolated struct TripCosts: Decodable {
    let currencies: [CurrencyTotal]
    let withoutCurrency: [CostEntry]
    let missingPrice: [MissingPrice]
    let due: [CostEntry]
    let entries: [CostEntry]
}

enum CostLogic {
    /// Fälligkeit vor heute: überfällig.
    static func isOverdue(_ dueDate: String?, today: String) -> Bool {
        guard let d = dueDate, !d.isEmpty else { return false }
        return String(d.prefix(10)) < today
    }

    /// „überfällig seit 1. März 2027“ bzw. „bis 1. März 2027“.
    static func dueText(_ dueDate: String, today: String) -> String {
        (isOverdue(dueDate, today: today) ? "überfällig seit " : "bis ") + Fmt.local(dueDate)
    }

    /// Bezeichnung einer Gruppe: Eintragsart oder Kreuzfahrt.
    static func kindLabel(_ kind: String, count: Int) -> (icon: String, label: String) {
        if kind == "cruise" { return ("🛳️", count == 1 ? "Kreuzfahrt" : "Kreuzfahrten") }
        return Labels.itemType(kind)
    }

    /// Betrag mit Währung, je Währung getrennt (nie umgerechnet).
    static func money(_ amount: Double?, _ currency: String?) -> String {
        guard let amount else { return "" }
        return Fmt.money(amount, currency)
    }

    static func paymentText(_ e: CostEntry) -> String {
        e.paymentStatus == "deposit" ? "angezahlt \(money(e.paid, e.currency))" : Labels.payment(e.paymentStatus)
    }
}

// MARK: - Teilen

enum ShareRights {
    static let roleLabels: [(role: String, label: String)] = [("owner", "Besitzer"), ("editor", "Bearbeiten"), ("viewer", "Nur ansehen")]

    static func label(_ role: String) -> String { roleLabels.first { $0.role == role }?.label ?? role }

    static func ownerCount(_ members: [Member]) -> Int { members.filter { $0.role == "owner" }.count }

    /// Rolle ändern und entfernen: nur Besitzer, nicht bei sich selbst.
    static func canManage(myRole: String?, member: Member, myId: String?) -> Bool {
        myRole == "owner" && member.userId != myId
    }

    /// Mitglieder hinzufügen: nur Besitzer.
    static func canAdd(myRole: String?) -> Bool { myRole == "owner" }

    /// Verlassen: jeder außer dem letzten Besitzer (der Server verlangt mindestens einen Besitzer).
    static func canLeave(myRole: String?, members: [Member]) -> Bool {
        guard myRole != nil else { return false }
        return myRole != "owner" || ownerCount(members) > 1
    }

    /// Wer aus der Familie noch nicht dabei ist.
    static func candidates(users: [User], members: [Member]) -> [User] {
        users.filter { u in !members.contains { $0.userId == u.id } }
    }
}

// MARK: - Einstellungen

enum SettingsSection: String, CaseIterable, Identifiable {
    case account, pace, reminders, device, family, ai, about
    var id: String { rawValue }

    var icon: String {
        switch self {
        case .account: return "👤"
        case .pace: return "⏱️"
        case .reminders: return "🔔"
        case .device: return "📱"
        case .family: return "👪"
        case .ai: return "✨"
        case .about: return "ℹ️"
        }
    }

    var title: String {
        switch self {
        case .account: return "Konto"
        case .pace: return "Zeitbedarf"
        case .reminders: return "Erinnerungen"
        case .device: return "Dieses Gerät"
        case .family: return "Familie"
        case .ai: return "KI und Dokumente"
        case .about: return "Über Reisebuch"
        }
    }

    var subtitle: String {
        switch self {
        case .account: return "Name, Passwort, Server, Abmelden"
        case .pace: return "Eigenes Tempo bei Mindestzeiten"
        case .reminders: return "Mitteilungen und Erinnerungen am Ort"
        case .device: return "Erlaubnisse, Offline-Daten, Zertifikat"
        case .family: return "Konten verwalten"
        case .ai: return "Claude, ChatGPT, Gemini"
        case .about: return "Version und Stand"
        }
    }

    /// Nur für Admins (wie Settings.tsx: Familie). „KI und Dokumente“ zeigt allen den Stand, Admins zusätzlich die Einrichtung.
    var adminOnly: Bool { self == .family }

    static func visible(isAdmin: Bool) -> [SettingsSection] {
        allCases.filter { !$0.adminOnly || isAdmin }
    }
}

nonisolated struct UserPace: Codable, Equatable {
    var enabled: Bool
    var factor: Double
    var extraMinutes: Int
}

nonisolated struct NotificationPrefs: Codable, Equatable {
    var enabled: Bool
    var boarding: Bool
    var boardingLead: Int
    var excursion: Bool
    var excursionLead: Int
    var transport: Bool
    var transportLead: Int
    var flightLead: Int
    var infoChange: Bool
}

nonisolated struct UserSettings: Decodable {
    let pace: UserPace
    let notifications: NotificationPrefs
}

enum PaceLogic {
    static let factors: [Double] = [1.25, 1.5, 1.75, 2, 2.5, 3]
    static let extras = [0, 5, 10, 15, 20, 30, 45, 60]

    /// Wie Pace.tsx: Minuten × Faktor + Zusatz, auf 5 min aufgerundet; aus = unverändert.
    static func personal(_ minutes: Int, _ pace: UserPace) -> Int {
        guard pace.enabled else { return minutes }
        let raw = Double(minutes) * pace.factor + Double(pace.extraMinutes)
        return Int((raw / 5).rounded(.up) * 5)
    }

    /// „Aus einer empfohlenen Zeit von 30 min werden 45 min.“
    static func example(_ pace: UserPace) -> String {
        pace.enabled ? "\(personal(30, pace)) min" : "30 min (aus)"
    }

    static func factorText(_ f: Double) -> String {
        "× " + (f == f.rounded() ? String(Int(f)) : String(f).replacingOccurrences(of: ".", with: ","))
    }

    /// Auswahl wie Web, der aktuelle Wert immer dabei.
    static func factorChoices(_ current: Double) -> [Double] { Array(Set(factors + [current])).sorted() }
    static func extraChoices(_ current: Int) -> [Int] { Array(Set(extras + [current])).sorted() }

    static func body(_ pace: UserPace) -> [String: JSONValue] {
        ["pace": .object(["enabled": .bool(pace.enabled), "factor": .number(pace.factor), "extraMinutes": .number(Double(pace.extraMinutes))])]
    }
}

enum ReminderLogic {
    static let leads = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]

    static func choices(_ current: Int) -> [Int] { Array(Set(leads + [current])).sorted() }

    /// „2 h vorher“ bzw. „45 min vorher“.
    static func leadText(_ m: Int) -> String {
        (m >= 60 && m % 60 == 0 ? "\(m / 60) h" : "\(m) min") + " vorher"
    }

    /// Teil-Update unter `notifications`.
    static func body(_ key: String, _ value: JSONValue) -> [String: JSONValue] {
        ["notifications": .object([key: value])]
    }
}

enum ProfileBody {
    /// PATCH /me: Anzeigename immer, Passwort nur, wenn ein neues eingegeben ist.
    static func make(displayName: String, currentPassword: String, newPassword: String) -> [String: JSONValue] {
        var body: [String: JSONValue] = ["displayName": .string(displayName.trimmingCharacters(in: .whitespaces))]
        if !newPassword.isEmpty {
            body["currentPassword"] = .string(currentPassword)
            body["newPassword"] = .string(newPassword)
        }
        return body
    }

    /// Prüfung vor dem Senden: neues Passwort zweimal gleich, aktuelles angegeben.
    static func check(currentPassword: String, newPassword: String, repeated: String) -> String? {
        guard !newPassword.isEmpty else { return nil }
        if currentPassword.isEmpty { return "Bitte das aktuelle Passwort eingeben." }
        if newPassword != repeated { return "Die beiden neuen Passwörter stimmen nicht überein." }
        if newPassword.count < 8 { return "Das neue Passwort braucht mindestens 8 Zeichen." }
        return nil
    }
}

// MARK: - Einladung (wie invite.ts)

enum Invite {
    /// Ohne 0/o, 1/l/i, die sich ähneln.
    static let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")

    /// Drei Vierergruppen, z. B. „k7mq-x2ap-r9tz“ (etwa 60 Bit), jedes Zeichen gleich wahrscheinlich.
    static func generatePassword() -> String {
        var rng = SystemRandomNumberGenerator()
        var out: [Character] = []
        while out.count < 12 {
            out.append(alphabet[Int.random(in: 0..<alphabet.count, using: &rng)])
        }
        return [out[0..<4], out[4..<8], out[8..<12]].map { String($0) }.joined(separator: "-")
    }

    static func text(displayName: String, username: String, password: String?, address: String) -> String {
        [
            "Hallo \(displayName),",
            "",
            "du hast jetzt Zugang zu Reisebuch, unserem Reiseplaner.",
            "",
            "Adresse: \(address)",
            "Benutzername: \(username)",
            password.map { "Startpasswort: \($0)" } ?? "Das Startpasswort bekommst du separat von mir.",
            "",
            "So geht's:",
            "1. VPN (WireGuard) einschalten.",
            "2. Die Adresse oben in Safari öffnen und anmelden.",
            "3. Dem Einrichtungsdialog folgen (Zertifikat, Home-Bildschirm, Erinnerungen).",
            "4. Das Passwort unter Einstellungen → Konto ändern.",
        ].joined(separator: "\n")
    }
}

// MARK: - Kreuzfahrt anlegen (Route wie CruiseForms.tsx)

enum CruiseRoute {
    static func nights(from: String?, to: String?) -> Int? {
        guard let from, let to, let f = LocalTime.date(from: from), let t = LocalTime.date(from: to) else { return nil }
        return Int((t.timeIntervalSince(f) / 86_400).rounded())
    }

    /// Einschiffung, Seetage dazwischen, Ausschiffung; ohne beide Daten keine Tage.
    static func days(from: String?, to: String?, fromPort: String, toPort: String, fromTz: String, toTz: String)
        -> (days: [JSONValue], error: String?) {
        guard let from, let to, let n = nights(from: from, to: to) else { return ([], nil) }
        guard n >= 1 && n <= 120 else { return ([], "Das Enddatum muss nach dem Startdatum liegen (max. 120 Nächte).") }
        var days: [JSONValue] = [.object(["date": .string(from), "kind": .string("embarkation"),
                                          "portName": EditMerge.text(fromPort), "timezone": EditMerge.text(fromTz)])]
        for i in 1..<n {
            if let d = LocalTime.addDays(from, i) { days.append(.object(["date": .string(d), "kind": .string("sea")])) }
        }
        days.append(.object(["date": .string(to), "kind": .string("disembarkation"), "portName": EditMerge.text(toPort),
                             "timezone": EditMerge.text(toTz.isEmpty ? fromTz : toTz)]))
        return (days, nil)
    }
}

// MARK: - Weitere Modelle

nonisolated struct CertInfo: Decodable {
    let present: Bool
    let subject: String?
    let validFrom: String?
    let validTo: String?
    let daysLeft: Int?
    let altNames: [String]?
}

nonisolated struct PushDevice: Decodable, Hashable {
    let deviceName: String?
    let createdAt: String?
    let kind: String?
}

nonisolated struct PushDevices: Decodable {
    let devices: [PushDevice]
}

// MARK: - Aufrufe (nur App)

extension APIClient {
    func costsRaw(tripId: String) async throws -> (data: Data, costs: TripCosts) {
        let data = try await perform("GET", "/api/trips/\(Self.pathID(tripId))/costs", body: nil)
        return (data, try Self.decode(TripCosts.self, from: data))
    }

    func setMember(tripId: String, userId: String, role: String) async throws {
        struct Body: Encodable { let role: String }
        let _: EmptyResponse = try await send("PUT", "/api/trips/\(Self.pathID(tripId))/members/\(Self.pathID(userId))", body: Body(role: role))
    }

    func removeMember(tripId: String, userId: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/trips/\(Self.pathID(tripId))/members/\(Self.pathID(userId))")
    }

    func users() async throws -> [User] {
        try await send("GET", "/api/users")
    }

    func createUser(username: String, displayName: String, password: String, isAdmin: Bool) async throws {
        struct Body: Encodable { let username: String; let displayName: String; let password: String; let isAdmin: Bool }
        let _: EmptyResponse = try await send("POST", "/api/users",
                                              body: Body(username: username, displayName: displayName, password: password, isAdmin: isAdmin))
    }

    func setPassword(userId: String, password: String) async throws {
        struct Body: Encodable { let password: String }
        let _: EmptyResponse = try await send("POST", "/api/users/\(Self.pathID(userId))/password", body: Body(password: password))
    }

    func deleteUser(userId: String) async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/users/\(Self.pathID(userId))")
    }

    func patchMe(_ body: JSONBody) async throws -> User {
        try await send("PATCH", "/api/me", body: body)
    }

    func settings() async throws -> UserSettings {
        try await send("GET", "/api/me/settings")
    }

    func patchSettings(_ body: JSONBody) async throws -> UserSettings {
        try await send("PATCH", "/api/me/settings", body: body)
    }

    func pushDevices() async throws -> PushDevices {
        try await send("GET", "/api/push/status")
    }

    func certificateInfo() async throws -> CertInfo {
        try await send("GET", "/api/certificate/info")
    }

    func uploadCertificate(pem: String) async throws {
        struct Body: Encodable { let pem: String }
        let _: EmptyResponse = try await send("PUT", "/api/certificate", body: Body(pem: pem))
    }

    func deleteCertificate() async throws {
        let _: EmptyResponse = try await send("DELETE", "/api/certificate")
    }

    func createCruise(tripId: String, _ body: JSONBody) async throws {
        let _: EmptyResponse = try await send("POST", "/api/trips/\(Self.pathID(tripId))/cruises", body: body)
    }
}

// ENDE SettingsLogic.swift
