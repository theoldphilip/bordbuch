//
//  SettingsView.swift
//  Reisebuch
//
//  Einstellungen wie in der Web-App (Auftrag 0.9.0, Settings.tsx): Liste der Bereiche mit Symbol, Titel und Untertitel, je Bereich
//  eine Seite. Konto, Persönlicher Zeitbedarf, Erinnerungen (Server-Einstellungen, Push auf diesem iPhone, Erinnerungen am Ort, Geräte),
//  Dieses Gerät (Erlaubnisse, Offline-Daten, Zertifikat), Familie (nur Admin), KI und Dokumente, Über Reisebuch.
//

import AVFoundation
import CoreLocation
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import UserNotifications

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if case .missingEntitlement = session.keychainMigration {
                    Section {
                        Text("Teilen-Erweiterung: Die Anmeldung ließ sich nicht freigeben (Schlüsselbund-Gruppe fehlt, -34018).")
                            .font(.footnote).foregroundStyle(.red)
                    }
                } else if case let .failed(status) = session.keychainMigration {
                    Section {
                        Text("Teilen-Erweiterung: Die Anmeldung ließ sich nicht freigeben (Fehler \(status)).")
                            .font(.footnote).foregroundStyle(.red)
                    }
                }
                Section {
                    ForEach(SettingsSection.visible(isAdmin: session.isAdmin)) { s in
                        NavigationLink {
                            page(s)
                        } label: {
                            HStack(spacing: 12) {
                                Text(s.icon).font(.title3)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.title)
                                    Text(s == .about ? "Version \(Fmt.appVersion())" : s.subtitle)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } footer: {
                    Text("Reisebuch · angemeldet als \(session.displayName)")
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .task { await session.refreshAIStatus() }
        }
    }

    @ViewBuilder
    private func page(_ s: SettingsSection) -> some View {
        switch s {
        case .account: AccountSettingsView(onLoggedOut: { dismiss() })
        case .pace: PaceSettingsView()
        case .reminders: ReminderSettingsView()
        case .device: DeviceSettingsView()
        case .family: FamilySettingsView()
        case .ai: AISettingsView()
        case .about: AboutSettingsView()
        }
    }
}

/// Grüne bzw. rote Meldung unter einem Formular.
private struct NoticeRow: View {
    let ok: Bool
    let text: String
    var body: some View { Text(text).foregroundStyle(ok ? Color.green : Color.red) }
}

// MARK: - Konto

struct AccountSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(PushController.self) private var push
    let onLoggedOut: () -> Void

    @State private var displayName = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var repeated = ""
    @State private var notice: (ok: Bool, text: String)?
    @State private var busy = false
    @State private var loggingOut = false

    var body: some View {
        Form {
            Section("Mein Profil") {
                TextField("Anzeigename", text: $displayName)
                SecureField("Aktuelles Passwort", text: $currentPassword).textContentType(.password)
                SecureField("Neues Passwort", text: $newPassword).textContentType(.newPassword)
                SecureField("Neues Passwort wiederholen", text: $repeated).textContentType(.newPassword)
                Button(busy ? "Speichert …" : "Speichern") { Task { await save() } }
                    .disabled(busy || displayName.trimmingCharacters(in: .whitespaces).isEmpty)
                if let notice { NoticeRow(ok: notice.ok, text: notice.text) }
            }
            Section("Server") {
                LabeledContent("Adresse", value: session.serverAddress)
                Text("Eine andere Adresse gibst du nach dem Abmelden bei der Anmeldung ein.").font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Button(role: .destructive) {
                    Task {
                        loggingOut = true
                        await push.logout()
                        await session.logout()
                        loggingOut = false
                        onLoggedOut()
                    }
                } label: {
                    if loggingOut { ProgressView() } else { Text("Abmelden") }
                }
                .disabled(loggingOut)
            } footer: {
                Text("Angemeldet als \(session.displayName)")
            }
        }
        .navigationTitle("Konto")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if displayName.isEmpty { displayName = session.displayName } }
    }

    private func save() async {
        notice = nil
        if let problem = ProfileBody.check(currentPassword: currentPassword, newPassword: newPassword, repeated: repeated) {
            notice = (false, problem)
            return
        }
        busy = true
        defer { busy = false }
        let changedPassword = !newPassword.isEmpty
        do {
            let body = ProfileBody.make(displayName: displayName, currentPassword: currentPassword, newPassword: newPassword)
            let me = try await session.call { try await $0.patchMe(body) }
            session.applyMe(me)
            currentPassword = ""
            newPassword = ""
            repeated = ""
            notice = (true, changedPassword ? "Gespeichert. Andere Geräte wurden abgemeldet." : "Gespeichert.")
        } catch {
            notice = (false, SaveError.text(error))
        }
    }
}

// MARK: - Persönlicher Zeitbedarf

struct PaceSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var pace: UserPace?
    @State private var notice: (ok: Bool, text: String)?

    var body: some View {
        Form {
            Section {
                Text("Für Wege, Ein- und Ausstiege, Transfers und Check-ins, bei denen du mehr Zeit brauchst als üblich. Alle empfohlenen Mindestzeiten (Anreise zum Schiff, Ausschiffung, Rückkehr von Ausflügen, Hotel-Check-out) werden dann mit deinem Faktor gerechnet. Angezeigt werden immer beide Zeiten: normal und persönlich. Die Einstellung gilt nur für dein Konto.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let pace {
                Section {
                    Toggle("Persönlichen Zeitbedarf berücksichtigen", isOn: Binding(get: { pace.enabled }, set: { v in
                        var p = pace; p.enabled = v; Task { await save(p) }
                    }))
                    Picker("Faktor", selection: Binding(get: { pace.factor }, set: { v in
                        var p = pace; p.factor = v; Task { await save(p) }
                    })) {
                        ForEach(PaceLogic.factorChoices(pace.factor), id: \.self) { Text(PaceLogic.factorText($0)).tag($0) }
                    }
                    .disabled(!pace.enabled)
                    Picker("Zusatzzeit pauschal", selection: Binding(get: { pace.extraMinutes }, set: { v in
                        var p = pace; p.extraMinutes = v; Task { await save(p) }
                    })) {
                        ForEach(PaceLogic.extraChoices(pace.extraMinutes), id: \.self) { Text($0 == 0 ? "keine" : "+ \($0) min").tag($0) }
                    }
                    .disabled(!pace.enabled)
                } footer: {
                    Text("Beispiel: Aus einer empfohlenen Zeit von 30 min werden \(PaceLogic.example(pace)).")
                }
                if let notice { Section { NoticeRow(ok: notice.ok, text: notice.text) } }
            } else if let notice {
                Section { NoticeRow(ok: notice.ok, text: notice.text) }
            } else {
                Section { ProgressView() }
            }
        }
        .navigationTitle("Persönlicher Zeitbedarf")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { pace = try await session.call { try await $0.settings() }.pace } catch { notice = (false, SaveError.text(error)) }
        }
    }

    private func save(_ next: UserPace) async {
        pace = next
        notice = nil
        do {
            pace = try await session.call { try await $0.patchSettings(PaceLogic.body(next)) }.pace
            notice = (true, "Gespeichert.")
            // Die Puffer-Hinweise der Abläufe hängen davon ab: neu laden.
            Task { await session.refreshAll() }
        } catch {
            notice = (false, SaveError.text(error))
        }
    }
}

// MARK: - Erinnerungen

struct ReminderSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(PushController.self) private var push
    @Environment(PlaceReminderController.self) private var places

    @State private var settings: UserSettings?
    @State private var devices: [PushDevice] = []
    @State private var errorText: String?

    var body: some View {
        Form {
            Section {
                Text("Reisebuch erinnert dich nach Uhrzeit, auch wenn die App geschlossen ist: vor „Alle an Bord“, vor dem Beginn eines Ausflugs und vor Abflug oder Abfahrt. Dein persönlicher Zeitbedarf verlängert den Vorlauf automatisch.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            pushSection
            if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            if let s = settings, s.notifications.enabled { rulesSection(s) }
            placesSection
            if !devices.isEmpty {
                Section("Angemeldete Geräte") {
                    ForEach(Array(devices.enumerated()), id: \.offset) { _, d in
                        LabeledContent(d.deviceName ?? "Gerät", value: d.kind == "app" ? "iPhone-App" : "Browser")
                    }
                }
            }
        }
        .navigationTitle("Erinnerungen")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .task { await push.loadServerStatus() }
        .task { if places.isOn { await places.plan() } }
        .onChange(of: push.isOn) { _, _ in Task { await load() } }
    }

    private func load() async {
        do {
            settings = try await session.call { try await $0.settings() }
            devices = (try? await session.call { try await $0.pushDevices() })?.devices ?? []
            errorText = nil
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func patch(_ key: String, _ value: JSONValue) async {
        errorText = nil
        do {
            settings = try await session.call { try await $0.patchSettings(ReminderLogic.body(key, value)) }
        } catch {
            errorText = SaveError.text(error)
        }
    }

    @ViewBuilder
    private var pushSection: some View {
        Section {
            switch push.serverEnabled {
            case nil:
                LabeledContent("Mitteilungen") { ProgressView() }
            case false?:
                Text("Auf dem Server noch nicht eingerichtet.").foregroundStyle(.secondary)
            case true?:
                Toggle("Auf diesem iPhone", isOn: Binding(
                    get: { push.isOn },
                    set: { on in Task { if on { await push.turnOn() } else { await push.turnOff() } } }
                ))
                .disabled(push.busy)
                Button {
                    Task { await push.sendTest() }
                } label: {
                    if push.testing { ProgressView() } else { Text("Testnachricht senden") }
                }
                .disabled(push.testing)
                if let text = push.testText { Text(text).font(.footnote) }
            }
            if let message = push.message { Text(message).font(.footnote).foregroundStyle(.red) }
        } header: {
            Text("Mitteilungen aufs iPhone")
        }
    }

    @ViewBuilder
    private func rulesSection(_ s: UserSettings) -> some View {
        let n = s.notifications
        Section("Wann erinnert wird") {
            rule("Alle an Bord", on: n.boarding, lead: n.boardingLead, keyOn: "boarding", keyLead: "boardingLead", pace: s.pace)
            rule("Ausflug beginnt", on: n.excursion, lead: n.excursionLead, keyOn: "excursion", keyLead: "excursionLead", pace: s.pace)
            rule("Abfahrt (Bahn, Bus, Fähre, Transfer)", on: n.transport, lead: n.transportLead, keyOn: "transport",
                 keyLead: "transportLead", pace: s.pace)
            VStack(alignment: .leading, spacing: 2) {
                Toggle("Gate, Schalter, Kofferband oder Gleis geändert", isOn: Binding(get: { n.infoChange }, set: { v in
                    Task { await patch("infoChange", .bool(v)) }
                }))
                Text("Wenn jemand anderes aus der Reise eine dieser Angaben einträgt oder ändert, kurz vor oder nach dem Termin.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Picker("Abflug", selection: Binding(get: { n.flightLead }, set: { v in Task { await patch("flightLead", .number(Double(v))) } })) {
                    ForEach(ReminderLogic.choices(n.flightLead), id: \.self) { Text(ReminderLogic.leadText($0)).tag($0) }
                }
                let personal = PaceLogic.personal(n.flightLead, s.pace)
                if personal != n.flightLead {
                    Text("Mit deinem persönlichen Zeitbedarf: \(personal) min vorher.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func rule(_ label: String, on: Bool, lead: Int, keyOn: String, keyLead: String, pace: UserPace) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Toggle(label, isOn: Binding(get: { on }, set: { v in Task { await patch(keyOn, .bool(v)) } }))
            Picker("Vorlauf", selection: Binding(get: { lead }, set: { v in Task { await patch(keyLead, .number(Double(v))) } })) {
                ForEach(ReminderLogic.choices(lead), id: \.self) { Text(ReminderLogic.leadText($0)).tag($0) }
            }
            .disabled(!on)
            let personal = PaceLogic.personal(lead, pace)
            if on && personal != lead {
                Text("Mit deinem persönlichen Zeitbedarf: \(personal) min vorher.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var placesSection: some View {
        Section {
            Toggle("Erinnerungen am Ort", isOn: Binding(
                get: { places.isOn },
                set: { on in Task { if on { await places.turnOn() } else { await places.turnOff() } } }
            ))
            .disabled(places.busy)
            if let message = places.message { Text(message).font(.footnote).foregroundStyle(.red) }
            if places.isOn {
                if places.geplant.isEmpty && places.nichtGefunden.isEmpty {
                    Text("Geplant: nichts in den nächsten 36 Stunden.").font(.footnote).foregroundStyle(.secondary)
                }
                if !places.geplant.isEmpty {
                    Text("Geplant").font(.footnote.bold()).foregroundStyle(.secondary)
                    ForEach(places.geplant) { g in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.kandidat.titel).font(.subheadline)
                            Text([g.ortName, "\(WidgetAuswahl.wochentag(g.kandidat.zeit, tz: g.kandidat.tz)) \(WidgetAuswahl.uhrzeit(g.kandidat.zeit, tz: g.kandidat.tz))"]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                ForEach(places.nichtGefunden) { k in
                    Text(k.suche.isEmpty ? "Kein Ort eingetragen: \(k.titel)" : "Ort nicht gefunden: \(k.titel) (\(k.suche[0].text))")
                        .font(.footnote).foregroundStyle(.orange)
                }
            }
        } header: {
            Text("Am Ort (auf diesem iPhone)")
        } footer: {
            Text("Erinnerungen am Ort funktionieren, wenn die App in den letzten Stunden vor der Abreise einmal geöffnet war oder iOS sie im Hintergrund aktualisieren durfte. Dein Standort verlässt das iPhone nicht.")
        }
    }
}

// MARK: - Dieses Gerät

struct DeviceSettingsView: View {
    @Environment(AppSession.self) private var session

    @State private var notifications = "…"
    @State private var location = "…"
    @State private var camera = "…"
    @State private var background = "…"
    @State private var cachedTrips = 0
    @State private var cacheSize: Int64 = 0
    @State private var refreshing = false
    @State private var cert: CertInfo?
    @State private var certError: String?
    @State private var showImporter = false
    @State private var confirmRemove = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Mitteilungen", value: notifications)
                LabeledContent("Standort", value: location)
                LabeledContent("Kamera", value: camera)
                LabeledContent("Hintergrundaktualisierung", value: background)
                Button("In iOS-Einstellungen öffnen") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            } header: {
                Text("Erlaubnisse")
            }
            Section {
                LabeledContent("Gespeicherte Reisen", value: "\(cachedTrips)")
                LabeledContent("Größe", value: ByteCountFormatter.string(fromByteCount: cacheSize, countStyle: .file))
                Button {
                    Task {
                        refreshing = true
                        await session.refreshAll()
                        refreshing = false
                        loadCache()
                    }
                } label: {
                    if refreshing { ProgressView() } else { Text("Offline-Daten neu laden") }
                }
                .disabled(refreshing)
            } header: {
                Text("Offline")
            } footer: {
                Text("Laufende und kommende Reisen sind ohne Netz lesbar. Abmelden löscht die Offline-Daten.")
            }
            certificateSection
        }
        .navigationTitle("Dieses Gerät")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadPermissions(); loadCache(); await loadCert() }
        .fileImporter(isPresented: $showImporter,
                      allowedContentTypes: ["pem", "crt", "cer"].compactMap { UTType(filenameExtension: $0) } + [.plainText]) { result in
            if case let .success(url) = result { Task { await upload(url) } }
        }
        .confirmationDialog("Das Zertifikat aus Reisebuch entfernen? Auf der Syno und auf den Geräten bleibt es unberührt.",
                            isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Entfernen", role: .destructive) { Task { await removeCert() } }
        }
    }

    @ViewBuilder
    private var certificateSection: some View {
        Section {
            if let cert {
                if cert.present {
                    let addresses = (cert.altNames ?? []).map { $0.replacingOccurrences(of: "IP Address:", with: "").replacingOccurrences(of: "DNS:", with: "") }
                    Text("Hinterlegt für \(addresses.isEmpty ? (cert.subject ?? "?") : addresses.joined(separator: ", ")), gültig bis \(cert.validTo.map { Fmt.local(String($0.prefix(10))) } ?? "?").")
                    if let days = cert.daysLeft, days < 60 {
                        Text(days < 0 ? "Das Zertifikat ist abgelaufen." : "Das Zertifikat läuft in \(days) Tagen ab.").foregroundStyle(.red)
                    }
                } else {
                    Text("Noch kein Zertifikat hinterlegt.").foregroundStyle(.secondary)
                }
                Text("Die App braucht das Zertifikat nur für die Adresse mit https://…:8444. Es wird in den iOS-Einstellungen installiert, nicht in der App.")
                    .font(.footnote).foregroundStyle(.secondary)
                if session.isAdmin {
                    Button(cert.present ? "Anderes Zertifikat hochladen" : "Zertifikat hochladen") { showImporter = true }
                    if cert.present { Button("Entfernen", role: .destructive) { confirmRemove = true } }
                }
            } else if certError == nil {
                ProgressView()
            }
            if let certError { Text(certError).foregroundStyle(.red) }
        } header: {
            Text("Zertifikat")
        } footer: {
            if session.isAdmin { Text("Nur das Zertifikat (bordbuch.pem), nie den privaten Schlüssel.") }
        }
    }

    private func loadPermissions() async {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: notifications = "erlaubt"
        case .denied: notifications = "nicht erlaubt"
        default: notifications = "noch nicht gefragt"
        }
        switch CLLocationManager().authorizationStatus {
        case .authorizedAlways: location = "immer"
        case .authorizedWhenInUse: location = "beim Verwenden"
        case .denied, .restricted: location = "nicht erlaubt"
        default: location = "noch nicht gefragt"
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: camera = "erlaubt"
        case .denied, .restricted: camera = "nicht erlaubt"
        default: camera = "noch nicht gefragt"
        }
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available: background = "an"
        case .denied: background = "aus"
        case .restricted: background = "eingeschränkt"
        @unknown default: background = "?"
        }
    }

    private func loadCache() {
        let files = ResponseCache.fileNames()
        cachedTrips = files.filter { $0.hasPrefix("timeline-") }.count
        cacheSize = files.reduce(0) { sum, f in
            sum + Int64(Upload.fileSize(ResponseCache.directory.appendingPathComponent(f)))
        }
    }

    private func loadCert() async {
        do {
            cert = try await session.call { try await $0.certificateInfo() }
            certError = nil
        } catch {
            certError = SaveError.text(error)
        }
    }

    private func upload(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let pem = try? String(contentsOf: url, encoding: .utf8) else { certError = "Die Datei ließ sich nicht lesen."; return }
        do {
            try await session.call { try await $0.uploadCertificate(pem: pem) }
            await loadCert()
        } catch {
            certError = SaveError.text(error)
        }
    }

    private func removeCert() async {
        do {
            try await session.call { try await $0.deleteCertificate() }
            await loadCert()
        } catch {
            certError = SaveError.text(error)
        }
    }
}

// MARK: - Familie (nur Admin)

struct FamilySettingsView: View {
    @Environment(AppSession.self) private var session

    @State private var users: [User] = []
    @State private var username = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var isAdmin = false
    @State private var errorText: String?
    @State private var busy = false
    @State private var invite: InviteData?
    @State private var resetFor: User?
    @State private var toDelete: User?

    struct InviteData: Identifiable {
        let id = UUID()
        let displayName: String
        let username: String
        let password: String
    }

    var body: some View {
        Form {
            if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            Section("Konten") {
                ForEach(users, id: \.id) { u in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(u.displayName)
                            Text("@\(u.username)\(u.isAdmin == true ? " · Admin" : "")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if u.id != session.userId {
                            Button("Passwort") { resetFor = u }.buttonStyle(.borderless)
                        }
                    }
                    .swipeActions {
                        if u.id != session.userId { Button("Löschen", role: .destructive) { toDelete = u } }
                    }
                }
            }
            Section {
                TextField("Benutzername", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Anzeigename", text: $displayName)
                HStack {
                    TextField("Startpasswort", text: $password).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Vorschlagen") { password = Invite.generatePassword() }.buttonStyle(.borderless)
                }
                Toggle("Ist Admin", isOn: $isAdmin)
                Button(busy ? "Legt an …" : "Familienmitglied anlegen") { Task { await add() } }
                    .disabled(busy || username.trimmingCharacters(in: .whitespaces).isEmpty || password.count < 8)
            } header: {
                Text("Neues Konto")
            } footer: {
                Text("Startpasswort mindestens 8 Zeichen. Der Vorschlag ist leicht abzutippen. Zum Löschen eines Kontos nach links wischen.")
            }
        }
        .navigationTitle("Familie")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $invite) { i in InviteView(displayName: i.displayName, username: i.username, password: i.password) }
        .sheet(item: Binding(get: { resetFor.map { IdentUser(user: $0) } }, set: { resetFor = $0?.user })) { wrapped in
            ResetPasswordView(user: wrapped.user) { pw in
                invite = InviteData(displayName: wrapped.user.displayName, username: wrapped.user.username, password: pw)
            }
        }
        .confirmationDialog("\(toDelete?.displayName ?? "") löschen?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { if let u = toDelete { Task { await remove(u) } } }
        } message: {
            Text("Reisen, die nur \(toDelete?.displayName ?? "diesem Konto") gehören, gehen an dich über.")
        }
    }

    struct IdentUser: Identifiable { let user: User; var id: String { user.id } }

    private func load() async {
        do { users = try await session.call { try await $0.users() } } catch { errorText = SaveError.text(error) }
    }

    private func add() async {
        errorText = nil
        busy = true
        defer { busy = false }
        let name = displayName.trimmingCharacters(in: .whitespaces).isEmpty ? username : displayName
        let user = username.trimmingCharacters(in: .whitespaces)
        do {
            try await session.call { try await $0.createUser(username: user, displayName: name, password: password, isAdmin: isAdmin) }
            invite = InviteData(displayName: name, username: user, password: password)
            username = ""
            displayName = ""
            password = ""
            isAdmin = false
            await load()
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func remove(_ u: User) async {
        errorText = nil
        do {
            try await session.call { try await $0.deleteUser(userId: u.id) }
            await load()
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

/// Neues Passwort für ein Konto, mit Vorschlag.
private struct ResetPasswordView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let user: User
    let onDone: (String) -> Void

    @State private var password = Invite.generatePassword()
    @State private var errorText: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Neues Passwort", text: $password).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Vorschlagen") { password = Invite.generatePassword() }.buttonStyle(.borderless)
                    }
                } footer: {
                    Text("Mindestens 8 Zeichen.")
                }
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            }
            .navigationTitle("Passwort für \(user.displayName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Setzen") { Task { await save() } }.disabled(password.count < 8)
                    }
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await session.call { try await $0.setPassword(userId: user.id, password: password) }
            let pw = password
            dismiss()
            onDone(pw)
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

/// Einladung wie InviteDialog.tsx: Text mit Adresse, Benutzername, wahlweise Passwort; bearbeitbar, teilen oder kopieren.
struct InviteView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let displayName: String
    let username: String
    let password: String

    @State private var withPassword = true
    @State private var address = ""
    @State private var edited: String?
    @State private var copied = false

    private var generated: String {
        Invite.text(displayName: displayName, username: username, password: withPassword ? password : nil, address: address)
    }
    private var text: String { edited ?? generated }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Das Konto ist bereit. Schick \(displayName) diese Nachricht, damit die Anmeldung klappt.")
                    ShareLink(item: text, subject: Text("Zugang zu Reisebuch")) { Label("Teilen …", systemImage: "square.and.arrow.up") }
                    Button(copied ? "Kopiert" : "Kopieren") {
                        UIPasteboard.general.string = text
                        copied = true
                    }
                }
                Section {
                    TextField("Adresse", text: Binding(get: { address }, set: { address = $0; edited = nil }))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Startpasswort in die Nachricht schreiben", isOn: Binding(get: { withPassword }, set: { withPassword = $0; edited = nil }))
                } footer: {
                    Text("Ausgeschaltet schickst du das Passwort getrennt, etwa per Anruf.")
                }
                Section("Nachricht") {
                    TextEditor(text: Binding(get: { text }, set: { edited = $0 })).frame(minHeight: 260)
                }
                Section {
                    Text("Das Startpasswort steht im Klartext in der Nachricht. Schicke sie nur an die Person selbst. \(displayName) sollte es nach der ersten Anmeldung unter Einstellungen → Konto ändern.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("\(displayName) einladen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .onAppear { if address.isEmpty { address = session.serverAddress } }
        }
    }
}

// MARK: - Über Reisebuch

struct AboutSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var server: ServerVersion?
    @State private var errorText: String?

    var body: some View {
        Form {
            Section {
                LabeledContent("App", value: Fmt.appVersion())
                LabeledContent("Server", value: server?.version ?? (errorText ?? "…"))
                LabeledContent("Gebaut am", value: server.map { $0.builtAt.map { Fmt.stamp(isoDate($0)) } ?? "Entwicklungsstand (kein Docker-Image)" } ?? "…")
                LabeledContent("Datenbank-Stand", value: server?.schema.map(String.init) ?? "…")
                LabeledContent("Adresse", value: session.serverAddress)
            } footer: {
                Text("Die iPhone-App hat eine eigene Versionsnummer, unabhängig von Server und Web-App.")
            }
        }
        .navigationTitle("Über Reisebuch")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let client = session.client else { errorText = "keine Adresse"; return }
            do { server = try await client.version() } catch { errorText = "nicht erreichbar" }
        }
    }

    private func isoDate(_ s: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s) ?? Date()
    }
}

// ENDE SettingsView.swift
