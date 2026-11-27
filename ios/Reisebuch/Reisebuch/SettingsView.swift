//
//  SettingsView.swift
//  Reisebuch
//
//  Kleine Einstellungsseite: angemeldet als, Server, Benachrichtigungen, Versionen, Abmelden.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(PushController.self) private var push
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
        } header: {
            Text("Benachrichtigungen")
        } footer: {
            if push.serverEnabled == true {
                Text("Wann und wofür erinnert wird (Vorlauf, Gate-Änderungen), stellst du in der Web-App unter Einstellungen → Erinnerungen ein.")
            }
        }
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
