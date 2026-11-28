//
//  SettingsView.swift
//  Reisebuch
//
//  Kleine Einstellungsseite: angemeldet als, Server, Benachrichtigungen (Push, Erinnerungen am Ort), Versionen, Abmelden.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(PushController.self) private var push
    @Environment(PlaceReminderController.self) private var places
    @Environment(\.dismiss) private var dismiss

    @State private var serverVersion: String?
    @State private var versionError: String?
    @State private var loggingOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Anmeldung") {
                    LabeledContent("Angemeldet als", value: session.displayName.isEmpty ? "–" : session.displayName)
                    LabeledContent("Server", value: session.serverAddress)
                }
                notificationsSection
                Section("Versionen") {
                    LabeledContent("App", value: Fmt.appVersion())
                    if let serverVersion {
                        LabeledContent("Server", value: serverVersion)
                    } else if let versionError {
                        LabeledContent("Server", value: versionError)
                    } else {
                        LabeledContent("Server") { ProgressView() }
                    }
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            loggingOut = true
                            await push.logout()
                            await session.logout()
                            loggingOut = false
                            dismiss()
                        }
                    } label: {
                        if loggingOut { ProgressView() } else { Text("Abmelden") }
                    }
                    .disabled(loggingOut)
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
            .task { await loadVersion() }
            .task { await push.loadServerStatus() }
            .task { if places.isOn { await places.plan() } }
        }
    }

    @ViewBuilder
    private var notificationsSection: some View {
        Section {
            switch push.serverEnabled {
            case nil:
                LabeledContent("Benachrichtigungen") { ProgressView() }
            case false?:
                Text("Auf dem Server noch nicht eingerichtet.")
                    .foregroundStyle(.secondary)
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
                if let text = push.testText {
                    Text(text).font(.footnote)
                }
            }
            if let message = push.message {
                Text(message).font(.footnote).foregroundStyle(.red)
            }
            Toggle("Erinnerungen am Ort", isOn: Binding(
                get: { places.isOn },
                set: { on in Task { if on { await places.turnOn() } else { await places.turnOff() } } }
            ))
            .disabled(places.busy)
            if let message = places.message {
                Text(message).font(.footnote).foregroundStyle(.red)
            }
            if places.isOn {
                placesList
            }
        } header: {
            Text("Benachrichtigungen")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if push.serverEnabled == true {
                    Text("Wann und wofür erinnert wird (Vorlauf, Gate-Änderungen), stellst du in der Web-App unter Einstellungen → Erinnerungen ein.")
                }
                Text("Erinnerungen am Ort funktionieren, wenn die App in den letzten Stunden vor der Abreise einmal geöffnet war oder iOS sie im Hintergrund aktualisieren durfte.")
            }
        }
    }

    /// Orte der nächsten 36 h: geplant und nicht gefunden.
    @ViewBuilder
    private var placesList: some View {
        if places.geplant.isEmpty && places.nichtGefunden.isEmpty {
            Text("Geplant: nichts in den nächsten 36 Stunden.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        if !places.geplant.isEmpty {
            Text("Geplant").font(.footnote.bold()).foregroundStyle(.secondary)
            ForEach(places.geplant) { g in
                VStack(alignment: .leading, spacing: 2) {
                    Text(g.kandidat.titel).font(.subheadline)
                    Text([g.ortName, Self.zeit(g.kandidat)].compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        ForEach(places.nichtGefunden) { k in
            Text(k.suche.isEmpty ? "Kein Ort eingetragen: \(k.titel)" : "Ort nicht gefunden: \(k.titel) (\(k.suche[0].text))")
                .font(.footnote).foregroundStyle(.orange)
        }
    }

    /// „Sa. 09:40“ in der Zeitzone des Anlasses.
    private static func zeit(_ k: OrtKandidat) -> String {
        "\(WidgetAuswahl.wochentag(k.zeit, tz: k.tz)) \(WidgetAuswahl.uhrzeit(k.zeit, tz: k.tz))"
    }

    private func loadVersion() async {
        guard let client = session.client else { versionError = "keine Adresse"; return }
        do {
            let v = try await client.version()
            var text = v.version ?? "?"
            if let schema = v.schema { text += " · Datenbank-Stand \(schema)" }
            serverVersion = text
        } catch is CancellationError {
            return
        } catch {
            versionError = "nicht erreichbar"
        }
    }
}

// ENDE SettingsView.swift
